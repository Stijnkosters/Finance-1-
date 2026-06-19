// Parse bank/card/PayPal-CSV. Houdt alleen uitgaven over, sluit uit wat al elders geteld wordt
// (NicheBay = COGS, Google/Meta/TikTok = ad spend), en categoriseert overhead.
// Per bron andere kolommen + tekenregel (creditcard: aankoop = positief).

export const SOURCES: Record<string, { type: "bank" | "creditcard" | "paypal"; label: string; name: string }> = {
  rabobank: { type: "bank", label: "RABO", name: "Rabobank" },
  wise: { type: "bank", label: "WISE", name: "Wise" },
  revolut: { type: "bank", label: "REVOLUT", name: "Revolut" },
  rabo_cc: { type: "creditcard", label: "RABO-CC", name: "Rabo creditcard" },
  amex: { type: "creditcard", label: "AMEX", name: "American Express" },
  paypal: { type: "paypal", label: "PAYPAL", name: "PayPal" },
  anders: { type: "bank", label: "OVERIG", name: "Anders" },
};

const EXCLUDE_DEFAULT = [
  "nichebay", "wscm", "winning supply",
  "google", "meta platforms", "facebook", "fb.com", "tiktok", "bytedance",
  "snap inc", "microsoft advertising", "bing ads", "pinterest",
];
const PAYPAL_EXTRA_EXCLUDE = [
  "general withdrawal", "withdraw", "transfer to your bank", "bank account",
  "top up", "opwaardering", "general card deposit",
];
const envExclude = (process.env.IMPORT_EXCLUDE || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const CATEGORY_RULES: [RegExp, string][] = [
  [/shopify/i, "Software"],
  [/klaviyo/i, "Software"],
  [/loox|parcel ?panel|judge\.?me|trustpilot|reviews?\.io/i, "Software"],
  [/openai|anthropic|claude|chatgpt|midjourney/i, "AI/Tools"],
  [/boekhoud|accountant|administratie|belasting/i, "Boekhouding"],
  [/wise|revolut|paypal|mollie|airwallex|klarna|stripe/i, "Bankkosten"],
  [/salaris|loon|payroll|medewerker|freelance|upwork|fiverr|kristina|maygon/i, "Team"],
  [/dhl|postnl|ups|fedex|verzend|shipping|track|parcel/i, "Verzending"],
  [/adobe|canva|figma|notion|slack|zoom|microsoft|office/i, "Software"],
];

// Eigen-rekening overboekingen / top-ups / kaart-aflossingen -> tag als "Transfer" (telt niet als kost).
export const TRANSFER_RE = /revolut|wise|airwallex|\bbunq\b|\bn26\b|american express|amex|creditcard|credit ?card|kaartnummer|rekeningoverzicht|eigen rekening|naar rekening|tussenrekening|spaarrekening|tikkie/i;

function parseAmount(s: string): number {
  s = (s || "").trim().replace(/[€$\s]/g, "");
  const neg = /-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[()+\-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

function normDate(s: string): string | null {
  s = (s || "").trim().replace(/"/g, "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseBankCsv(text: string, sourceKey = "rabobank") {
  const src = SOURCES[sourceKey] || SOURCES.anders;
  const exclude = [...EXCLUDE_DEFAULT, ...envExclude, ...(src.type === "paypal" ? PAYPAL_EXTRA_EXCLUDE : [])];

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { expenses: [], stats: { total: 0, added: 0, excluded: 0, income: 0 }, header: [], source: src.name };

  const delim = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const header = splitCsvLine(lines[0], delim).map((h) => h.trim().toLowerCase().replace(/"/g, ""));

  const di = header.findIndex((h) => /datum|date|boekdatum|transactiedatum|rentedatum|completed|started/.test(h));
  // amount-kolom: PayPal prefereert net/gross
  let ai = -1;
  if (src.type === "paypal") {
    ai = header.findIndex((h) => /\bnet\b|netto/.test(h));
    if (ai < 0) ai = header.findIndex((h) => /gross|bruto/.test(h));
  }
  if (ai < 0) ai = header.findIndex((h) => /bedrag|amount/.test(h));

  const nameIdx = header.findIndex((h) => /naam tegenpartij|tegenpartij|naam|counterparty|merchant|name/.test(h));
  const descIdxs = header.map((h, i) => (/omschrijving|mededeling|description|memo|narrative|reference/.test(h) ? i : -1)).filter((i) => i >= 0);

  const expenses: any[] = [];
  let excluded = 0, income = 0, transfers = 0;

  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r], delim).map((c) => c.replace(/^"|"$/g, ""));
    const date = di >= 0 ? normDate(cols[di]) : null;
    const amount = ai >= 0 ? parseAmount(cols[ai]) : 0;
    if (!date) continue;

    // tekenregel: bank/paypal -> uitgave = negatief; creditcard -> uitgave = positief (aankoop)
    const isExpense = src.type === "creditcard" ? amount > 0 : amount < 0;
    if (!isExpense || amount === 0) { income++; continue; }

    const namePart = nameIdx >= 0 ? cols[nameIdx] : "";
    const descPart = descIdxs.map((i) => cols[i]).filter(Boolean).join(" ");
    const desc = ([namePart, descPart].filter(Boolean).join(" — ").trim()) || "(geen omschrijving)";

    const hay = desc.toLowerCase();
    if (exclude.some((k) => hay.includes(k))) { excluded++; continue; }

    let category = "Overig";
    for (const [re, cat] of CATEGORY_RULES) { if (re.test(desc)) { category = cat; break; } }
    if (TRANSFER_RE.test(desc)) { category = "Transfer"; transfers++; }

    expenses.push({ date, omschrijving: desc.slice(0, 120), methode: src.label, bedrag: Math.abs(amount), category });
  }

  return { expenses, stats: { total: lines.length - 1, added: expenses.length, excluded, income, transfers }, header, source: src.name };
}

export function dedupKey(e: any): string {
  return `${e.date}|${Number(e.bedrag).toFixed(2)}|${e.methode}|${(e.omschrijving || "").slice(0, 40)}`;
}
