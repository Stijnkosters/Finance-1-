import { NextRequest, NextResponse } from "next/server";
import { clientId, clientSecret, makeState, OAUTH_SCOPES, storeDomainFor, isValidShopDomain } from "@/lib/shopifyAuth";
import { SHOP_IDS } from "@/lib/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop") || "homivo";
  if (!SHOP_IDS.includes(shopId)) {
    return NextResponse.json({ ok: false, error: `Onbekende shop "${shopId}".` }, { status: 400 });
  }
  if (!clientId() || !clientSecret()) {
    return NextResponse.json(
      { ok: false, error: "Zet SHOPIFY_CLIENT_ID en SHOPIFY_CLIENT_SECRET als env-variabelen in Railway." },
      { status: 500 },
    );
  }
  const shopDomain = storeDomainFor(shopId);
  if (!shopDomain || !isValidShopDomain(shopDomain)) {
    return NextResponse.json(
      { ok: false, error: `Zet eerst het store-domein (bv. ${shopId.toUpperCase()}_SHOPIFY_STORE_DOMAIN = <handle>.myshopify.com) in Railway.` },
      { status: 400 },
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/shopify/callback`;
  const state = makeState(shopId);
  const authorize = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", clientId());
  authorize.searchParams.set("scope", OAUTH_SCOPES);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);

  const res = NextResponse.redirect(authorize.toString());
  // state ook in een korte cookie voor extra CSRF-check
  res.cookies.set("shopify_oauth_state", state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}
