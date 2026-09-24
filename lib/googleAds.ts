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

// Returns { spend, conv } per dag ('YYYY-MM-DD' → €). conv = conversiewaarde
// (Google's eigen gemeten omzet) voor de ROAS per kanaal.
export async function fetchGoogleStatsByDay(from: string, to: string, customerId?: string, loginCustomerId?: string): Promise<{ spend: Record<string, number>; conv: Record<string, number> }> {
  const cid = (customerId || "").replace(/-/g, "") || CUSTOMER_ID;
  const login = (loginCustomerId || "").replace(/-/g, "") || LOGIN_CUSTOMER_ID;
  const token = await getAccessToken();
  const query =
    `SELECT segments.date, metrics.cost_micros, metrics.conversions_value FROM customer ` +
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
  const spend: Record<string, number> = {};
  const conv: Record<string, number> = {};
  const batches = Array.isArray(data) ? data : [data];
  for (const b of batches) {
    for (const row of b.results || []) {
      const date = row.segments?.date;
      if (!date) continue;
      spend[date] = (spend[date] || 0) + Number(row.metrics?.costMicros || 0) / 1e6;
      conv[date] = (conv[date] || 0) + Number(row.metrics?.conversionsValue || 0);
    }
  }
  return { spend, conv };
}

// Backwards-compat: alleen de spend-map.
export async function fetchAdSpendByDay(from: string, to: string, customerId?: string, loginCustomerId?: string): Promise<Record<string, number>> {
  return (await fetchGoogleStatsByDay(from, to, customerId, loginCustomerId)).spend;
}

// Geo-target-constant-ID → ISO2, voor de landen waar we op adverteren.
const GEO_ISO: Record<string, string> = {
  "2528": "NL", "2056": "BE", "2276": "DE", "2840": "US", "2250": "FR",
  "2826": "GB", "2040": "AT", "2442": "LU", "2724": "ES", "2380": "IT",
  "2372": "IE", "2752": "SE", "2208": "DK", "2616": "PL", "2620": "PT",
  "2756": "CH", "2578": "NO", "2246": "FI",
};

// Google-adspend per land (ISO2 → €), o.b.v. de fysieke locatie van de klant.
export async function fetchGoogleSpendByCountry(from: string, to: string, customerId?: string, loginCustomerId?: string): Promise<Record<string, number>> {
  const cid = (customerId || "").replace(/-/g, "") || CUSTOMER_ID;
  const login = (loginCustomerId || "").replace(/-/g, "") || LOGIN_CUSTOMER_ID;
  const token = await getAccessToken();
  const query =
    `SELECT geographic_view.country_criterion_id, metrics.cost_micros FROM geographic_view ` +
    `WHERE segments.date BETWEEN '${from}' AND '${to}' AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'`;

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
  if (!res.ok) throw new Error(`Google Ads geo ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const out: Record<string, number> = {};
  const batches = Array.isArray(data) ? data : [data];
  for (const b of batches) {
    for (const row of b.results || []) {
      const id = String(row.geographicView?.countryCriterionId ?? "");
      const iso = GEO_ISO[id] || "??";
      out[iso] = (out[iso] || 0) + Number(row.metrics?.costMicros || 0) / 1e6;
    }
  }
  return out;
}
