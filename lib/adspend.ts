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

// Route B: gepubliceerde Google Sheet als CSV. Verwacht kolommen 'date' en 'cost' (of datum/kosten).
async function fetchFromSheet(): Promise<Record<string, number>> {
  if (!SHEET_CSV_URL) return {};
  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet CSV ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return {};
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  let di = header.findIndex((h) => /date|datum|day/.test(h));
  let ci = header.findIndex((h) => /cost|spend|kosten|bedrag/.test(h));
  let start = 1;
  if (di === -1 || ci === -1) { di = 0; ci = 1; start = normalizeDate(header[0]) ? 0 : 1; }
  const map: Record<string, number> = {};
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = normalizeDate(cols[di]);
    const cost = parseFloat((cols[ci] || "").replace(/["€\s]/g, "").replace(",", "."));
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
