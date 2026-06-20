// PayPal REST API: haalt saldo (Reporting Balances) en transacties (Transaction Search) op.
// Vereist een Live REST-app: PAYPAL_CLIENT_ID + PAYPAL_SECRET (developer.paypal.com).
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

export async function paypalBalance() {
  if (!paypalConfigured()) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_SECRET ontbreken.");
  const tk = await token();
  const res = await fetch(`${BASE}/v1/reporting/balances?currency_code=EUR`, {
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal balances ${res.status}: ${text.slice(0, 200)}`);
  let j: any = {}; try { j = JSON.parse(text); } catch {}
  const balances = j.balances || [];
  const eurRow = balances.find((b: any) => (b.currency || b.total_balance?.currency_code) === "EUR") || balances[0];
  const eur = Number(eurRow?.total_balance?.value ?? eurRow?.available_balance?.value ?? 0);
  return { eur, raw: balances };
}

// transacties van de afgelopen N dagen (PayPal staat max 31 dagen per call toe)
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
  const txs = details.map((d: any) => {
    const info = d.transaction_info || {};
    const payer = d.payer_info || {};
    const name = payer.payer_name?.alternate_full_name || payer.email_address || "";
    const note = info.transaction_note || info.transaction_subject || info.bank_reference_id || "";
    const desc = [name, note].filter(Boolean).join(" — ") || "PayPal-transactie";
    return {
      date: (info.transaction_initiation_date || "").slice(0, 10),
      desc,
      amount: Number(info.transaction_amount?.value ?? 0),
    };
  }).filter((t: any) => t.date);
  return txs;
}
