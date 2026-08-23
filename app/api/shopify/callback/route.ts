import { NextRequest, NextResponse } from "next/server";
import {
  clientId, clientSecret, readState, verifyShopifyHmac, isValidShopDomain, saveOAuth,
} from "@/lib/shopifyAuth";
import { SHOP_IDS } from "@/lib/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(origin: string, msg: string) {
  const url = new URL(`${origin}/`);
  url.searchParams.set("shopify_error", msg);
  return NextResponse.redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const origin = req.nextUrl.origin;
  const shop = p.get("shop") || "";
  const code = p.get("code") || "";
  const state = p.get("state") || "";

  // 1. HMAC van Shopify verifiëren
  if (!verifyShopifyHmac(p)) return fail(origin, "OAuth-handtekening ongeldig.");

  // 2. state controleren (bevat shopId, gesigneerd) + cookie-match
  const st = readState(state);
  const cookieState = req.cookies.get("shopify_oauth_state")?.value;
  if (!st || (cookieState && cookieState !== state)) return fail(origin, "OAuth-state ongeldig.");
  if (!SHOP_IDS.includes(st.shopId)) return fail(origin, "Onbekende shop in state.");
  if (!isValidShopDomain(shop)) return fail(origin, "Ongeldig shop-domein.");
  if (!code) return fail(origin, "Geen autorisatiecode ontvangen.");

  // 3. code inwisselen voor een offline access token (server-side, met secret)
  let token = "", scope = "";
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId(), client_secret: clientSecret(), code }),
      cache: "no-store",
    });
    if (!r.ok) return fail(origin, `Token-uitwisseling faalde (${r.status}).`);
    const j = await r.json();
    token = j.access_token;
    scope = j.scope || "";
  } catch (e: any) {
    return fail(origin, `Token-uitwisseling faalde: ${e.message}`);
  }
  if (!token) return fail(origin, "Geen access token ontvangen.");

  // 4. opslaan op het volume
  try {
    await saveOAuth(st.shopId, { shop, token, scope });
  } catch (e: any) {
    return fail(origin, `Opslaan mislukt (DATA_DIR?): ${e.message}`);
  }

  const done = new URL(`${origin}/`);
  done.searchParams.set("shopify_connected", st.shopId);
  const res = NextResponse.redirect(done.toString());
  res.cookies.set("shopify_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
