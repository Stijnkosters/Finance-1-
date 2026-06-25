import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE = "https://ads.microsoft.com/ads.manage offline_access";

function page(inner: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 16px;line-height:1.55;color:#1A1D24">
    <h2>Bing / Microsoft Advertising — refresh token</h2>${inner}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: Request) {
  const cid = process.env.BING_CLIENT_ID;
  const secret = process.env.BING_CLIENT_SECRET;
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || url.host;
  // redirect = deze pagina zelf, zodat Microsoft de code terugstuurt naar de app
  const redirect = process.env.BING_REDIRECT_URI || `${proto}://${host}/api/bing/token`;

  if (!cid || !secret) {
    return page(`<p><b>Zet eerst deze twee in Railway en redeploy:</b></p>
      <pre>BING_CLIENT_ID = ...
BING_CLIENT_SECRET = ...</pre><p>Open daarna deze pagina opnieuw.</p>`);
  }

  const err = url.searchParams.get("error");
  if (err) {
    return page(`<p style="color:#CE2C2C"><b>Microsoft gaf een fout:</b> ${err}</p>
      <p>${url.searchParams.get("error_description") || ""}</p>
      <p><b>Bijna altijd op te lossen in Azure:</b></p>
      <ol>
        <li>Azure portal → <b>App registrations</b> → jouw app → <b>Authentication</b>.</li>
        <li>Onder <b>Platform configurations</b>: voeg een <b>Web</b>-platform toe (niet "Mobile and desktop") met deze exacte redirect-URI:<br>
          <code style="background:#f4f4f6;padding:2px 6px;border-radius:5px">${redirect}</code></li>
        <li>Verwijder eventueel de oude <code>nativeclient</code>-URI.</li>
        <li>Onder <b>Supported account types</b>: kies <b>"Accounts in any organizational directory and personal Microsoft accounts"</b>.</li>
        <li>Opslaan → open dan deze pagina opnieuw (zonder <code>?code</code>/<code>?error</code>).</li>
      </ol>`);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    const auth = `${AUTH_URL}?client_id=${encodeURIComponent(cid)}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&response_mode=query&scope=${encodeURIComponent(SCOPE)}`;
    return page(`
      <p><b>Belangrijk — registreer eerst deze redirect-URI in Azure</b> (App registrations → jouw app → Authentication → platform <b>Web</b>):</p>
      <p><code style="background:#f4f4f6;padding:4px 8px;border-radius:6px;word-break:break-all">${redirect}</code></p>
      <p>Daarna: <b><a href="${auth}">klik hier om in te loggen en toestemming te geven</a></b>.</p>
      <p style="color:#8A909C">Na "Accept" stuurt Microsoft je automatisch terug naar deze pagina en verschijnt je refresh token meteen — geen kopiëren nodig.</p>`);
  }

  try {
    const body = new URLSearchParams({
      client_id: cid, client_secret: secret, code,
      redirect_uri: redirect, grant_type: "authorization_code", scope: SCOPE,
    });
    const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
    const j: any = await res.json().catch(() => ({}));
    if (!j.refresh_token) {
      return page(`<p style="color:#CE2C2C">Geen refresh token. Antwoord van Microsoft:</p>
        <pre style="white-space:pre-wrap;background:#f4f4f6;padding:12px;border-radius:8px">${JSON.stringify(j, null, 2)}</pre>
        <p>Code verlopen? Begin opnieuw via <a href="/api/bing/token">/api/bing/token</a>. Redirect-mismatch? Controleer dat <code>${redirect}</code> exact in Azure (Web) staat.</p>`);
    }
    return page(`
      <p style="color:#0E8A52"><b>✅ Gelukt!</b> Zet dit in Railway als <b>BING_REFRESH_TOKEN</b> en redeploy:</p>
      <textarea readonly style="width:100%;height:140px;font-family:monospace;padding:10px;border:1px solid #ddd;border-radius:8px">${j.refresh_token}</textarea>`);
  } catch (e: any) {
    return page(`<p style="color:#CE2C2C">Fout bij ophalen token: ${e.message}</p>`);
  }
}
