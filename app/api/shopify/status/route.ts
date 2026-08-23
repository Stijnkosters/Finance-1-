import { NextRequest, NextResponse } from "next/server";
import { getStoredOAuth, resolveShopifyCfg, clientId, clientSecret } from "@/lib/shopifyAuth";
import { getShop, SHOP_IDS } from "@/lib/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop") || "homivo";
  if (!SHOP_IDS.includes(shopId)) {
    return NextResponse.json({ ok: false, error: "Onbekende shop." }, { status: 400 });
  }
  const shop = getShop(shopId);
  const cfg = await resolveShopifyCfg(shop);
  const oauth = await getStoredOAuth(shopId);
  return NextResponse.json({
    ok: true,
    shop: shopId,
    storeDomain: shop.shopify.store || oauth?.shop || null,
    hasEnvToken: !!shop.shopify.token,
    hasOAuth: !!oauth,
    connected: !!(cfg.store && cfg.token),
    oauthShop: oauth?.shop || null,
    obtainedAt: oauth?.obtainedAt || null,
    oauthConfigured: !!(clientId() && clientSecret()),
  });
}

// Koppeling ongedaan maken.
export async function DELETE(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop") || "homivo";
  if (!SHOP_IDS.includes(shopId)) {
    return NextResponse.json({ ok: false, error: "Onbekende shop." }, { status: 400 });
  }
  try {
    const { writeJson } = await import("@/lib/store");
    const { oauthFile } = await import("@/lib/shopifyAuth");
    await writeJson(oauthFile(shopId), {});
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
