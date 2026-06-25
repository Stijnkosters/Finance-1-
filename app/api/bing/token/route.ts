import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE = "https://ads.microsoft.com/ads.manage offline_access";
const REDIRECT = process.env.BING_REDIRECT_URI || "https://login.microsoftonline.com/common/oauth2/nativeclient";

function page(inner: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.55;color:#1A1D24">
    <h2>Bing / Microsoft Advertising — refresh token</h2>${inner}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: Request) {
  const cid = process.env.BING_CLIENT_ID;
  const secret = process.env.BING_CLIENT_SECRET;
  if (!cid || !secret) {
    return page(`<p><b>Zet eerst deze twee in Railway en redeploy:</b></p>
      <pre>BING_CLIENT_ID = ...
BING_CLIENT_SECRET = ...</pre>
      <p>Open daarna deze pagina opnieuw.</p>`);
  }

  const code = new URL(req.url).searchParams.get("code");
  if (!code) {
    const auth = `${AUTH_URL}?client_id=${encodeURIComponent(cid)}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&response_mode=query&scope=${encodeURIComponent(SCOPE)}`;
    return page(`
      <ol>
        <li><b>Klik op deze link</b>, log in met het Microsoft-account dat toegang heeft tot je advertenties, en geef toestemming:<br><br>
          <a href="${auth}" style="word-break:break-all">${auth}</a>
        </li>
        <li>Na toestemming land je op een (vrijwel lege) <code>login.microsoftonline.com/.../nativeclient</code>-pagina.
          Kopieer in de <b>adresbalk</b> alles na <code>code=</code> (tot een eventuele <code>&amp;</code>).</li>
        <li>Plak die code hierachter en open: <code>?code=JOUW_CODE</code><br>
          (dus deze pagina opnieuw, met <code>?code=...</code> erachter)</li>
      </ol>
      <p style="color:#8A909C">De code is maar ~10 minuten geldig — doe stap 3 meteen.</p>`);
  }

  // code -> tokens
  try {
    const body = new URLSearchParams({
      client_id: cid, client_secret: secret, code,
      redirect_uri: REDIRECT, grant_type: "authorization_code", scope: SCOPE,
    });
    const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
    const j: any = await res.json().catch(() => ({}));
    if (!j.refresh_token) {
      return page(`<p style="color:#CE2C2C">Geen refresh token ontvangen. Antwoord van Microsoft:</p>
        <pre style="white-space:pre-wrap;background:#f4f4f6;padding:12px;border-radius:8px">${JSON.stringify(j, null, 2)}</pre>
        <p>Vaak betekent dit: code verlopen (begin opnieuw zonder <code>?code=</code>), of redirect-URI komt niet exact overeen met die in je Azure-app.</p>`);
    }
    return page(`
      <p style="color:#0E8A52"><b>✅ Gelukt!</b> Zet dit in Railway als <b>BING_REFRESH_TOKEN</b> en redeploy:</p>
      <textarea readonly style="width:100%;height:140px;font-family:monospace;padding:10px;border:1px solid #ddd;border-radius:8px">${j.refresh_token}</textarea>
      <p style="color:#8A909C">Daarna haalt de app je Bing-spend automatisch op en telt 'm op bij Google in je P&amp;L.</p>`);
  } catch (e: any) {
    return page(`<p style="color:#CE2C2C">Fout bij ophalen token: ${e.message}</p>`);
  }
}
