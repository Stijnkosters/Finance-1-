import { googleAdsConfigured, fetchAdSpendByDay } from "@/lib/googleAds";
import adspendData from "@/data/adspend.json";

const SHEET_CSV_URL = process.env.GOOGLE_SHEET_CSV_URL;
const manual: Record<string, number> = (adspendData as any).adspend || {};

function normalizeDate(s: string): string | null {
  s = (s || "").trim().replace(/"/g, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); // DD-MM-YYYY of DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseNum(s: string): number {
  let t = (s || "").replace(/["€$\s]/g, "").trim();
  if (!t) return NaN;
  const hasDot = t.includes("."), hasComma = t.includes(",");
  if (hasDot && hasComma) {
    // laatste scheidingsteken = decimaal; de andere is duizendtal
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (hasComma) {
    t = t.replace(",", "."); // EU decimaal
  }
  return parseFloat(t);
}

// Route B: gepubliceerde Google Sheet als CSV. Verwacht kolommen 'date'/'day' en 'cost'/'kosten'.
// Robuust voor de Google Ads-add-on die metadata-regels bovenaan zet vóór de echte koprij.
async function fetchFromSheet(): Promise<Record<string, number>> {
  if (!SHEET_CSV_URL) return {};
  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet CSV ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return {};

  // zoek de koprij: eerste regel met zowel een datum- als een kosten-kolom
  let headerIdx = -1, di = -1, ci = -1;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const h = splitCsvLine(lines[i]).map((x) => x.trim().toLowerCase().replace(/"/g, ""));
    const d = h.findIndex((x) => /^date$|datum|^day$/.test(x));
    const c = h.findIndex((x) => /cost|spend|kosten|bedrag/.test(x));
    if (d !== -1 && c !== -1) { headerIdx = i; di = d; ci = c; break; }
  }
  let start: number;
  if (headerIdx !== -1) { start = headerIdx + 1; }
  else {
    // geen koprij gevonden: zoek de eerste regel die als datum,bedrag leest
    di = 0; ci = 1; start = 0;
    while (start < lines.length && !normalizeDate(splitCsvLine(lines[start])[0])) start++;
  }

  const map: Record<string, number> = {};
  for (let i = start; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const date = normalizeDate(cols[di]);
    const cost = parseNum(cols[ci]);
    if (date && !isNaN(cost)) map[date] = (map[date] || 0) + cost;
  }
  return map;
}

export async function resolveAdSpend(from: string, to: string) {
  let map: Record<string, number> = { ...manual };
  let source = "manual";
  let warning: string | null = null;

  if (googleAdsConfigured()) {
    try {
      const g = await fetchAdSpendByDay(from, to);
      map = { ...map, ...g };
      source = "google_ads";
    } catch (e: any) {
      warning = `Google Ads koppeling faalde (${e.message}). Val terug op handmatige/Sheet-waarden.`;
    }
  }
  if (source !== "google_ads" && SHEET_CSV_URL) {
    try {
      const s = await fetchFromSheet();
      map = { ...map, ...s };
      if (Object.keys(s).length) source = "sheet";
    } catch (e: any) {
      warning = (warning ? warning + " " : "") + `Sheet-CSV faalde (${e.message}).`;
    }
  }
  return { map, source, warning };
}
