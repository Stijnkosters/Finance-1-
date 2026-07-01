// PayPal REST API: haalt saldo (Reporting Balances) en transacties (Transaction Search) op.
// Vereist een Live REST-app met "Transaction search" aan: PAYPAL_CLIENT_ID + PAYPAL_SECRET.
import { toEUR } from "./fx";

const BASE = process.env.PAYPAL_API_BASE || "https://api-m.paypal.com";
const CID = process.env.PAYPAL_CLIENT_ID || "";
const SECRET = process.env.PAYPAL_SECRET || "";

export function paypalConfigured() {
  return !!(CID && SECRET);
}

async function token() {
  const auth = Buffer.from(`${CID}:${SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`PayPal auth ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}

// Saldo van ALLE valuta-potjes, elk omgerekend naar EUR (dagkoers) en opgeteld.
export async function paypalBalance() {
  if (!paypalConfigured()) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_SECRET ontbreken.");
  const tk = await token();
  const res = await fetch(`${BASE}/v1/reporting/balances`, {
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal balances ${res.status}: ${text.slice(0, 200)}`);
  let j: any = {}; try { j = JSON.parse(text); } catch {}
  const balances = j.balances || [];
  const today = new Date().toISOString().slice(0, 10);
  let eur = 0;
  const breakdown: any[] = [];
  for (const b of balances) {
    const cur = (b.currency || b.total_balance?.currency_code || "EUR").toUpperCase();
    const val = Number(b.total_balance?.value ?? b.available_balance?.value ?? 0);
    if (!val) continue;
    if (cur === "EUR") { eur += val; breakdown.push({ currency: "EUR", value: val, eur: val }); continue; }
    const e = await toEUR(val, cur, today);
    if (e == null) { breakdown.push({ currency: cur, value: val, eur: null }); continue; }
    eur += e;
    breakdown.push({ currency: cur, value: val, eur: Math.round(e * 100) / 100 });
  }
  return { eur: Math.round(eur * 100) / 100, breakdown };
}

// Transacties van de afgelopen N dagen (PayPal: max 31 dagen per call). Vreemde valuta -> EUR.
export async function paypalTransactions(days = 31) {
  if (!paypalConfigured()) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_SECRET ontbreken.");
  const tk = await token();
  const end = new Date();
  const start = new Date(end.getTime() - Math.min(days, 31) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "-0000";
  const url = `${BASE}/v1/reporting/transactions?start_date=${encodeURIComponent(iso(start))}&end_date=${encodeURIComponent(iso(end))}&fields=all&page_size=500&page=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal transactions ${res.status}: ${text.slice(0, 200)}`);
  let j: any = {}; try { j = JSON.parse(text); } catch {}
  const details = j.transaction_details || [];
  const raw = details.map((d: any) => {
    const info = d.transaction_info || {};
    const payer = d.payer_info || {};
    const name = payer.payer_name?.alternate_full_name || payer.email_address || "";
    const note = info.transaction_note || info.transaction_subject || info.bank_reference_id || "";
    const desc = [name, note].filter(Boolean).join(" — ") || "PayPal-transactie";
    const amt = info.transaction_amount || {};
    const code = String(info.transaction_event_code || "");
    // T1106/T1107 = terugbetaling/omkering (klant-refund), T12xx = chargeback
    const isRefund = /^T11(06|07)/.test(code) || /^T12/.test(code);
    return {
      date: (info.transaction_initiation_date || "").slice(0, 10),
      desc,
      amount: Number(amt.value ?? 0),
      currency: (amt.currency_code || "EUR").toUpperCase(),
      isRefund,
    };
  }).filter((t: any) => t.date && t.amount);

  // Vreemde valuta omrekenen naar EUR op de transactiedatum; originele valuta in de omschrijving tonen.
  const txs: { date: string; desc: string; amount: number; category?: string }[] = [];
  let converted = 0, fxFailed = 0, refunds = 0;
  for (const t of raw) {
    let amount = t.amount;
    let desc = t.desc;
    if (t.currency && t.currency !== "EUR") {
      const e = await toEUR(t.amount, t.currency, t.date);
      if (e == null) { fxFailed++; continue; }
      amount = e; desc = `${t.desc} [${t.currency} ${t.amount}]`;
      converted++;
    }
    if (t.isRefund) { txs.push({ date: t.date, desc: `Refund — ${desc}`, amount, category: "Refund klant" }); refunds++; }
    else txs.push({ date: t.date, desc, amount });
  }
  return { txs, fx: { converted, failed: fxFailed, total: raw.length, refunds } };
}
