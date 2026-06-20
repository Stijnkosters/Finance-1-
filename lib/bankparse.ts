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
  [/huur|pand|verhuur|kantoorruimte|kantoor|opslag|warehouse|storage|garagebox/i, "Pandkosten"],
  [/adobe|canva|figma|notion|slack|zoom|microsoft|office/i, "Software"],
  [/leverancier|supplier|inkoop|wholesale|groothandel|alibaba|aliexpress|1688|dsers|cjdropshipping|autods/i, "Leverancier betalingen"],
];

// Eigen-rekening overboekingen / top-ups / kaart-aflossingen -> tag als "Transfer" (telt niet als kost).
export const TRANSFER_RE = /revolut|wise|airwallex|\bbunq\b|\bn26\b|american express|amex|creditcard|credit ?card|kaartnummer|rekeningoverzicht|eigen rekening|naar rekening|tussenrekening|spaarrekening|tikkie/i;
// creditcard-aflossing / bijschrijving van je eigen betaling (geen refund)
const PAYMENT_RE = /payment|betaling|thank you|received|ontvangen|incasso|autom|direct debit|sepa|aflossing|verrekening/i;
// echte refund / terugbetaling van een leverancier (op een bankrekening)
const REFUND_RE = /refund|terugbetaling|terugstorting|restitutie|chargeback|credit ?nota|geld terug|reversal|retour/i;
function matchedExclude(hay: string, exclude: string[]) { return exclude.find((k) => hay.includes(k)) || null; }

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

// Wise-specifieke lezer: Direction (OUT=uitgave), bedrag = source amount na fees + fee.
function parseWise(lines: string[], delim: string, header: string[], exclude: string[]) {
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iDate = idx(/created on/) >= 0 ? idx(/created on/) : idx(/finished on|date/);
  const iDir = idx(/direction/);
  const iAmt = idx(/source amount/);
  const iFee = idx(/source fee amount/);
  const iCur = idx(/source currency/);
  const iTgt = idx(/target name/);
  const iRef = idx(/reference/);
  const iNote = idx(/^note$/);
  const iBal = idx(/running balance|^balance$|balance$/);

  const expenses: any[] = [];
  let excluded = 0, income = 0, transfers = 0, skipped = 0;
  let endBalance: any = null;
  const monthBal: Record<string, { amount: number; date: string }> = {};
  const flow: Record<string, { in: number; out: number }> = {};
  const incomeRows: any[] = [];
  const excludedRows: any[] = [];

  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r], delim).map((c) => c.replace(/^"|"$/g, ""));
    const dir = (iDir >= 0 ? cols[iDir] : "").toUpperCase();

    const date = normDate(iDate >= 0 ? cols[iDate] : "");
    if (date && iBal >= 0 && cols[iBal]) {
      const bal = parseAmount(cols[iBal]);
      if (!endBalance || date >= endBalance.date) endBalance = { amount: bal, date };
      const mk = date.slice(0, 7);
      if (!monthBal[mk] || date >= monthBal[mk].date) monthBal[mk] = { amount: bal, date };
    }
    if (date) {
      const amt = parseAmount(iAmt >= 0 ? cols[iAmt] : "0") + (iFee >= 0 && dir === "OUT" ? parseAmount(cols[iFee]) : 0);
      const mk = date.slice(0, 7);
      if (!flow[mk]) flow[mk] = { in: 0, out: 0 };
      if (dir === "OUT") flow[mk].out += Math.abs(amt); else if (dir === "IN") flow[mk].in += Math.abs(amt);
    }

    if (dir !== "OUT") {
      if (dir === "IN" && date) {
        const t = iTgt >= 0 ? cols[iTgt] : "";
        const rf = iRef >= 0 ? cols[iRef] : "";
        const nt = iNote >= 0 ? cols[iNote] : "";
        const d = [t, rf || nt].filter(Boolean).join(" — ").trim() || "(Wise inkomend)";
        const a = Math.abs(parseAmount(iAmt >= 0 ? cols[iAmt] : "0"));
        if (a) incomeRows.push({ date, omschrijving: d.slice(0, 120), methode: "WISE", bedrag: a, category: TRANSFER_RE.test(d) ? "Transfer" : "Inkomsten" });
      }
      income++; continue;
    } // alleen geld eruit telt als uitgave
    if (!date) { skipped++; continue; }

    const cur = (iCur >= 0 ? cols[iCur] : "EUR").toUpperCase();
    const amount = parseAmount(iAmt >= 0 ? cols[iAmt] : "0") + (iFee >= 0 ? parseAmount(cols[iFee]) : 0);
    if (!amount) { skipped++; continue; }

    const tgt = iTgt >= 0 ? cols[iTgt] : "";
    const ref = iRef >= 0 ? cols[iRef] : "";
    const note = iNote >= 0 ? cols[iNote] : "";
    let desc = [tgt, ref || note].filter(Boolean).join(" — ").trim() || "(Wise overboeking)";
    if (cur && cur !== "EUR") desc = `${desc} [${cur}]`;

    const hay = desc.toLowerCase();
    { const xk = matchedExclude(hay, exclude); if (xk) { excluded++; excludedRows.push({ date, omschrijving: desc.slice(0, 120), methode: "WISE", bedrag: Math.abs(amount), reason: xk }); continue; } }

    let category = "Overig";
    for (const [re, cat] of CATEGORY_RULES) { if (re.test(desc)) { category = cat; break; } }
    if (TRANSFER_RE.test(desc)) { category = "Transfer"; transfers++; }

    expenses.push({ date, omschrijving: desc.slice(0, 120), methode: "WISE", bedrag: Math.abs(amount), category });
  }

  const monthlyBalances: Record<string, number> = {};
  for (const k of Object.keys(monthBal)) monthlyBalances[k] = monthBal[k].amount;

  return { expenses, stats: { total: lines.length - 1, added: expenses.length, excluded, income, transfers, skipped, otherCurrency: 0 }, header, source: "Wise", endBalance, monthlyBalances, monthlyFlow: flow, incomeRows, excludedRows, };
}

export function parseBankCsv(text: string, sourceKey = "rabobank") {
  const src = SOURCES[sourceKey] || SOURCES.anders;
  const exclude = [...EXCLUDE_DEFAULT, ...envExclude, ...(src.type === "paypal" ? PAYPAL_EXTRA_EXCLUDE : [])];

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { expenses: [], stats: { total: 0, added: 0, excluded: 0, income: 0, transfers: 0, skipped: 0, otherCurrency: 0 }, header: [], source: src.name, endBalance: null, monthlyBalances: {}, monthlyFlow: {}, incomeRows: [], excludedRows: [] };

  const delim = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const header = splitCsvLine(lines[0], delim).map((h) => h.trim().toLowerCase().replace(/"/g, ""));

  // Wise heeft een eigen format (Direction OUT/IN + Source amount). Aparte lezer.
  if (header.includes("direction") && header.some((h) => /source amount/.test(h))) {
    return parseWise(lines, delim, header, exclude);
  }

  const di = header.findIndex((h) => /datum|date|boekdatum|transactiedatum|rentedatum|completed|started|created/.test(h));
  // amount-kolom: PayPal prefereert net/gross
  let ai = -1;
  if (src.type === "paypal") {
    ai = header.findIndex((h) => /\bnet\b|netto/.test(h));
    if (ai < 0) ai = header.findIndex((h) => /gross|bruto/.test(h));
  }
  if (ai < 0) ai = header.findIndex((h) => /bedrag|amount/.test(h));

  const nameIdx = header.findIndex((h) => /naam tegenpartij|tegenpartij|naam|counterparty|merchant|name/.test(h));
  const descIdxs = header.map((h, i) => (/omschrijving|mededeling|description|memo|narrative|reference/.test(h) ? i : -1)).filter((i) => i >= 0);
  const balIdx = header.findIndex((h) => /saldo na trn|saldo|running balance|^balance$|balance$/.test(h));
  const curIdx = header.findIndex((h) => /^currency$|^valuta$|^munt$|muntsoort|ccy/.test(h));

  const expenses: any[] = [];
  let excluded = 0, income = 0, transfers = 0, skipped = 0, otherCurrency = 0;
  let endBalance: any = null;
  const monthBal: Record<string, { amount: number; date: string }> = {};
  const flow: Record<string, { in: number; out: number }> = {};
  const incomeRows: any[] = [];
  const excludedRows: any[] = [];

  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r], delim).map((c) => c.replace(/^"|"$/g, ""));
    const date = di >= 0 ? normDate(cols[di]) : null;
    const amount = ai >= 0 ? parseAmount(cols[ai]) : 0;
    const blank = cols.every((c) => !c || !c.trim());
    if (!date) { if (!blank) skipped++; continue; }

    // alleen EUR meenemen; andere valuta (USD/GBP) overslaan zodat ze niet als euro's tellen
    const rowCur = curIdx >= 0 ? (cols[curIdx] || "").toUpperCase().trim() : "";
    if (rowCur && rowCur !== "EUR") { otherCurrency++; continue; }

    if (balIdx >= 0 && cols[balIdx] != null && cols[balIdx] !== "") {
      const bal = parseAmount(cols[balIdx]);
      if (!endBalance || date >= endBalance.date) endBalance = { amount: bal, date };
      const mk = date.slice(0, 7);
      if (!monthBal[mk] || date >= monthBal[mk].date) monthBal[mk] = { amount: bal, date };
    }

    // geldstroom (alleen echte rekeningen, niet creditcards)
    if (src.type !== "creditcard" && amount !== 0) {
      const mk = date.slice(0, 7);
      if (!flow[mk]) flow[mk] = { in: 0, out: 0 };
      if (amount > 0) flow[mk].in += amount; else flow[mk].out += -amount;
    }

    const namePart = nameIdx >= 0 ? cols[nameIdx] : "";
    const descPart = descIdxs.map((i) => cols[i]).filter(Boolean).join(" ");
    const desc = ([namePart, descPart].filter(Boolean).join(" — ").trim()) || "(geen omschrijving)";
    const hay = desc.toLowerCase();

    // CREDITCARD: + = aankoop (uitgave), - = refund of aflossing
    if (src.type === "creditcard") {
      if (amount === 0) continue;
      if (amount < 0) {
        // aflossing/betaling van de kaart vanaf je bank = transfer, geen refund
        if (PAYMENT_RE.test(desc)) { transfers++; continue; }
        // echte refund -> negatieve uitgave (haalt kosten eraf), en telt als geld erin
        { const xk = matchedExclude(hay, exclude); if (xk) { excluded++; excludedRows.push({ date, omschrijving: desc.slice(0, 120), methode: src.label, bedrag: Math.abs(amount), reason: xk }); continue; } }
        let rcat = "Overig";
        for (const [re, c] of CATEGORY_RULES) { if (re.test(desc)) { rcat = c; break; } }
        const mk = date.slice(0, 7);
        if (!flow[mk]) flow[mk] = { in: 0, out: 0 };
        flow[mk].in += Math.abs(amount);
        expenses.push({ date, omschrijving: ("Refund — " + desc).slice(0, 120), methode: src.label, bedrag: -Math.abs(amount), category: rcat });
        continue;
      }
      // amount > 0 -> aankoop op de kaart
      { const xk = matchedExclude(hay, exclude); if (xk) { excluded++; excludedRows.push({ date, omschrijving: desc.slice(0, 120), methode: src.label, bedrag: Math.abs(amount), reason: xk }); continue; } }
      let ccat = "Overig";
      for (const [re, c] of CATEGORY_RULES) { if (re.test(desc)) { ccat = c; break; } }
      if (TRANSFER_RE.test(desc)) { ccat = "Transfer"; transfers++; }
      expenses.push({ date, omschrijving: desc.slice(0, 120), methode: src.label, bedrag: amount, category: ccat });
      continue;
    }

    // BANK / PAYPAL
    if (amount > 0) {
      // echte refund/terugbetaling van een leverancier -> negatieve uitgave (haalt kosten eraf)
      if (REFUND_RE.test(desc) && !TRANSFER_RE.test(desc) && !exclude.some((k) => hay.includes(k))) {
        let rcat = "Overig";
        for (const [re, c] of CATEGORY_RULES) { if (re.test(desc)) { rcat = c; break; } }
        expenses.push({ date, omschrijving: ("Refund — " + desc).slice(0, 120), methode: src.label, bedrag: -Math.abs(amount), category: rcat });
        continue;
      }
      income++;
      incomeRows.push({ date, omschrijving: desc.slice(0, 120), methode: src.label, bedrag: Math.abs(amount), category: TRANSFER_RE.test(desc) ? "Transfer" : "Inkomsten" });
      continue; // overige inkomsten (uitbetalingen, transfers) = cashflow "erin" + inkomstenlijst
    }
    if (amount === 0) { income++; continue; }
    // amount < 0 -> uitgave
    { const xk = matchedExclude(hay, exclude); if (xk) { excluded++; excludedRows.push({ date, omschrijving: desc.slice(0, 120), methode: src.label, bedrag: Math.abs(amount), reason: xk }); continue; } }

    let category = "Overig";
    for (const [re, cat] of CATEGORY_RULES) { if (re.test(desc)) { category = cat; break; } }
    if (TRANSFER_RE.test(desc)) { category = "Transfer"; transfers++; }

    expenses.push({ date, omschrijving: desc.slice(0, 120), methode: src.label, bedrag: Math.abs(amount), category });
  }

  const monthlyBalances: Record<string, number> = {};
  for (const k of Object.keys(monthBal)) monthlyBalances[k] = monthBal[k].amount;

  return { expenses, stats: { total: lines.length - 1, added: expenses.length, excluded, income, transfers, skipped, otherCurrency }, header, source: src.name, endBalance, monthlyBalances, monthlyFlow: flow, incomeRows, excludedRows };
}

export type TxKind =
  | { kind: "expense"; category: string; bedrag: number }
  | { kind: "income"; category: string; bedrag: number }
  | { kind: "excluded"; reason: string }
  | { kind: "skip" };

// Classificeert één transactie met dezelfde regels als de CSV-parser.
// Gebruikt door de API-koppelingen (GoCardless / PayPal).
export function classifyTx(sourceKey: string, desc: string, amount: number): TxKind {
  const src = SOURCES[sourceKey] || SOURCES.anders;
  const exclude = [...EXCLUDE_DEFAULT, ...envExclude, ...(src.type === "paypal" ? PAYPAL_EXTRA_EXCLUDE : [])];
  const hay = (desc || "").toLowerCase();
  const xMatch = exclude.find((k) => hay.includes(k)) || null;
  const catOf = () => { for (const [re, c] of CATEGORY_RULES) if (re.test(desc || "")) return c; return "Overig"; };

  if (!amount) return { kind: "skip" };

  if (src.type === "creditcard") {
    if (amount < 0) {
      if (PAYMENT_RE.test(desc || "")) return { kind: "skip" };        // kaart-aflossing
      if (xMatch) return { kind: "excluded", reason: xMatch };
      return { kind: "expense", category: catOf(), bedrag: -Math.abs(amount) }; // refund
    }
    if (xMatch) return { kind: "excluded", reason: xMatch };
    if (TRANSFER_RE.test(desc || "")) return { kind: "expense", category: "Transfer", bedrag: amount };
    return { kind: "expense", category: catOf(), bedrag: amount };
  }

  // bank / paypal
  if (amount > 0) {
    if (REFUND_RE.test(desc || "") && !TRANSFER_RE.test(desc || "") && !xMatch)
      return { kind: "expense", category: catOf(), bedrag: -Math.abs(amount) }; // refund
    return { kind: "income", category: TRANSFER_RE.test(desc || "") ? "Transfer" : "Inkomsten", bedrag: Math.abs(amount) };
  }
  if (xMatch) return { kind: "excluded", reason: xMatch };
  return { kind: "expense", category: TRANSFER_RE.test(desc || "") ? "Transfer" : catOf(), bedrag: Math.abs(amount) };
}

export function dedupKey(e: any): string {
  return `${e.date}|${Number(e.bedrag).toFixed(2)}|${e.methode}|${(e.omschrijving || "").slice(0, 40)}`;
}
