// GoCardless Bank Account Data (voorheen Nordigen): EU Open Banking, gratis tier.
// Vereist GC_SECRET_ID + GC_SECRET_KEY (bankaccountdata.gocardless.com -> User Secrets).
const BASE = process.env.GC_API_BASE || "https://bankaccountdata.gocardless.com/api/v2";
const SID = process.env.GC_SECRET_ID || "";
const SKEY = process.env.GC_SECRET_KEY || "";

export function gcConfigured() {
  return !!(SID && SKEY);
}

async function token() {
  const res = await fetch(`${BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ secret_id: SID, secret_key: SKEY }),
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access) throw new Error(`GoCardless auth ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access as string;
}

async function gcGet(path: string, tk: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tk}`, Accept: "application/json" }, cache: "no-store" });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

export async function gcInstitutions(country = "nl") {
  const tk = await token();
  const r = await gcGet(`/institutions/?country=${country}`, tk);
  if (!r.ok) throw new Error(`GoCardless institutions ${r.status}: ${r.text.slice(0, 200)}`);
  return (r.json || []).map((i: any) => ({ id: i.id, name: i.name, bic: i.bic, logo: i.logo }));
}

// Start een koppeling: maakt een requisition en geeft de toestemmings-link terug.
export async function gcCreateRequisition(institutionId: string, redirect: string, reference: string) {
  const tk = await token();
  const res = await fetch(`${BASE}/requisitions/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ redirect, institution_id: institutionId, reference, user_language: "NL" }),
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.link) throw new Error(`GoCardless requisition ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return { id: j.id, link: j.link, institutionId };
}

export async function gcRequisition(id: string, tk?: string) {
  const t = tk || (await token());
  const r = await gcGet(`/requisitions/${id}/`, t);
  if (!r.ok) throw new Error(`GoCardless requisition ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json; // { id, status, accounts: [], institution_id, reference }
}

export async function gcAccountData(accountId: string, tk: string) {
  const bal = await gcGet(`/accounts/${accountId}/balances/`, tk);
  const txs = await gcGet(`/accounts/${accountId}/transactions/`, tk);
  const details = await gcGet(`/accounts/${accountId}/details/`, tk);

  let balance: { amount: number; currency: string } | null = null;
  if (bal.ok && bal.json?.balances?.length) {
    // voorkeur: interimAvailable / closingBooked
    const pick = bal.json.balances.find((b: any) => /available|closingBooked|expected/i.test(b.balanceType)) || bal.json.balances[0];
    balance = { amount: Number(pick.balanceAmount?.amount ?? 0), currency: pick.balanceAmount?.currency || "EUR" };
  }

  const booked = txs.ok ? (txs.json?.transactions?.booked || []) : [];
  const list = booked.map((t: any) => {
    const name = t.creditorName || t.debtorName || "";
    const info = Array.isArray(t.remittanceInformationUnstructuredArray)
      ? t.remittanceInformationUnstructuredArray.join(" ")
      : (t.remittanceInformationUnstructured || t.additionalInformation || "");
    const desc = [name, info].filter(Boolean).join(" — ") || "(geen omschrijving)";
    return {
      date: (t.bookingDate || t.valueDate || "").slice(0, 10),
      desc,
      amount: Number(t.transactionAmount?.amount ?? 0),
    };
  }).filter((t: any) => t.date);

  const iban = details.ok ? (details.json?.account?.iban || "") : "";
  return { balance, transactions: list, iban };
}

// Raadt de interne bron-sleutel op basis van de instellingsnaam.
export function guessSourceKey(institutionName: string): string {
  const n = (institutionName || "").toLowerCase();
  if (n.includes("american express") || n.includes("amex")) return "amex";
  if (n.includes("rabobank")) return "rabobank";
  if (n.includes("revolut")) return "revolut";
  if (n.includes("paypal")) return "paypal";
  if (n.includes("wise")) return "wise";
  return "anders";
}

export { token as gcToken };
