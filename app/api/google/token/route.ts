import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || "";
const SCOPE = "https://www.googleapis.com/auth/adwords";

function redirectUri(req: NextRequest) {
  const url = new URL(req.url);
  return `${url.origin}/api/google/token`;
}

function page(body: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Google Ads herauthorisatie</title>
    <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1f2a44}
    a.btn{display:inline-block;background:#1a73e8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600}
    code,pre{background:#f2f4f8;border:1px solid #d9dee8;border-radius:6px;padding:2px 6px}
    pre{padding:14px;overflow:auto;white-space:pre-wrap;word-break:break-all}
    .ok{color:#0e8a52}.err{color:#ce2c2c}</style></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return page(`<h2 class="err">Ontbrekende env vars</h2><p>GOOGLE_ADS_CLIENT_ID en/of GOOGLE_ADS_CLIENT_SECRET staan niet in Railway.</p>`);
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const ruri = redirectUri(req);

  if (error) {
    return page(`<h2 class="err">Google gaf een fout</h2><pre>${error}: ${url.searchParams.get("error_description") || ""}</pre><p><a class="btn" href="${ruri}">Opnieuw proberen</a></p>`);
  }

  if (!code) {
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", ruri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", SCOPE);
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent"); // forceert een nieuwe refresh_token
    return page(`<h2>Google Ads opnieuw koppelen</h2>
      <p>Zorg eerst dat deze redirect-URI in je Google Cloud OAuth-client staat (Google Cloud Console → APIs &amp; Services → Credentials → jouw OAuth 2.0 Client → Authorized redirect URIs):</p>
      <pre>${ruri}</pre>
      <p>Klik daarna op onderstaande knop, log in met het account dat toegang heeft tot je Google Ads, en geef toestemming:</p>
      <p><a class="btn" href="${auth.toString()}">Google Ads koppelen</a></p>`);
  }

  // code -> tokens
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: ruri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const j: any = await res.json();
  if (!res.ok || !j.refresh_token) {
    return page(`<h2 class="err">Kon geen refresh token krijgen</h2>
      <pre>${JSON.stringify(j, null, 2)}</pre>
      <p>Meestal betekent 'geen refresh_token' dat je al eerder toestemming gaf. Ga terug en probeer opnieuw — de link forceert nu <code>prompt=consent</code>.</p>
      <p><a class="btn" href="${ruri}">Opnieuw proberen</a></p>`);
  }
  return page(`<h2 class="ok">Gelukt ✅</h2>
    <p>Zet deze waarde in Railway als <code>GOOGLE_ADS_REFRESH_TOKEN</code> (vervang de oude) en redeploy:</p>
    <pre>${j.refresh_token}</pre>
    <p><b>Belangrijk:</b> zet je OAuth-consent screen op <b>Production</b> (Google Cloud Console → OAuth consent screen → Publish app), anders verloopt deze token na 7 dagen opnieuw.</p>`);
}
