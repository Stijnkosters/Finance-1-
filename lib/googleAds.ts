// Route A: directe Google Ads API. Haalt dagelijkse advertentiekosten op.
// Vereist een eigen developer token (API Center in een Manager-account) + OAuth refresh token.

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, "");
const LOGIN_CUSTOMER_ID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
const VERSION = process.env.GOOGLE_ADS_API_VERSION || "v24";

// customerId optioneel: per-shop account. Zonder → het standaard-account (Drivemax).
export function googleAdsConfigured(customerId?: string) {
  const cid = (customerId || "").replace(/-/g, "") || CUSTOMER_ID;
  return !!(DEV_TOKEN && CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && cid);
}

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID as string,
      client_secret: CLIENT_SECRET as string,
      refresh_token: REFRESH_TOKEN as string,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.access_token;
}

// Returns { 'YYYY-MM-DD': spendInEuro }. customerId + loginCustomerId optioneel
// (per-shop account + bijbehorende MCC).
export async function fetchAdSpendByDay(from: string, to: string, customerId?: string, loginCustomerId?: string): Promise<Record<string, number>> {
  const cid = (customerId || "").replace(/-/g, "") || CUSTOMER_ID;
  const login = (loginCustomerId || "").replace(/-/g, "") || LOGIN_CUSTOMER_ID;
  const token = await getAccessToken();
  const query =
    `SELECT segments.date, metrics.cost_micros FROM customer ` +
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "developer-token": DEV_TOKEN as string,
  };
  if (login) headers["login-customer-id"] = login;

  const res = await fetch(
    `https://googleads.googleapis.com/${VERSION}/customers/${cid}/googleAds:searchStream`,
    { method: "POST", headers, body: JSON.stringify({ query }), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Google Ads ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json(); // array van { results: [...] }
  const map: Record<string, number> = {};
  const batches = Array.isArray(data) ? data : [data];
  for (const b of batches) {
    for (const row of b.results || []) {
      const date = row.segments?.date;
      const micros = Number(row.metrics?.costMicros || 0);
      if (date) map[date] = (map[date] || 0) + micros / 1e6;
    }
  }
  return map;
}
