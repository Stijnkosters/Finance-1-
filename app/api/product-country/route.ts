import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify";
import { getShop, shopConfigured } from "@/lib/shops";
import costsDrivemax from "@/data/costs.json";
import costsHomivo from "@/data/costs-homivo.json";

// ============================================================
// Per-product-per-land Shopify-verkopen (voor ADSGUARD): valideert
// uitsluit-adviezen (verkoopt het product écht in dat land?) en levert
// re-test-vraagdata. Beveiligd met FINANCE_API_SECRET.
// ============================================================

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COSTS_BY_KEY: Record<string, Record<string, { title: string; price: number; cost: number }>> = {
  drivemax: (costsDrivemax as any).costs || {},
  homivo: (costsHomivo as any).costs || {},
};

function authorized(req: Request): boolean {
  const expected = process.env.FINANCE_API_SECRET;
  if (!expected) return true;
  const url = new URL(req.url);
  const provided = req.headers.get("x-finance-secret") || url.searchParams.get("secret");
  return provided === expected;
}

const ORDERS_Q = `
query Orders($cursor: String, $q: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      shippingAddress { countryCodeV2 }
      lineItems(first: 50) {
        nodes {
          quantity
          title
          variant { id }
          discountedTotalSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const defFrom = new Date();
    defFrom.setDate(defFrom.getDate() - 30);
    const from = searchParams.get("from") || defFrom.toISOString().slice(0, 10);
    const shopParam = searchParams.get("shop") || "drivemax";

    const shop = getShop(shopParam);
    if (!shopConfigured(shop)) {
      return NextResponse.json({ ok: false, error: `Shop "${shopParam}" niet geconfigureerd.` }, { status: 400 });
    }
    const costs = COSTS_BY_KEY[shop.costsKey] || {};

    const q = `created_at:>='${from}T00:00:00Z' created_at:<='${to}T23:59:59Z'`;
    let cursor: string | null = null;
    // key = `${country}||${variantId||title}`
    const agg = new Map<string, { country: string; variantId: string; title: string; units: number; revenue: number }>();

    for (let i = 0; i < 50; i++) {
      const data = await shopifyGraphQL(ORDERS_Q, { cursor, q }, shop.shopify);
      const conn = data.orders;
      for (const o of conn.nodes) {
        const country = o.shippingAddress?.countryCodeV2 || "??";
        for (const li of o.lineItems?.nodes || []) {
          const variantId = li.variant?.id || "";
          const title = li.title || variantId || "(onbekend)";
          const key = `${country}||${variantId || title}`;
          const cur = agg.get(key) ?? { country, variantId, title, units: 0, revenue: 0 };
          cur.units += li.quantity || 0;
          cur.revenue += parseFloat(li.discountedTotalSet?.shopMoney?.amount || "0") || 0;
          agg.set(key, cur);
        }
      }
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }

    const rows = [...agg.values()].map((r) => {
      const c = costs[r.variantId];
      const unitCost = c?.cost || 0;
      return {
        country: r.country,
        variantId: r.variantId,
        title: r.title,
        units: r.units,
        revenue: Math.round(r.revenue * 100) / 100,
        unitCost,
        cogs: Math.round(unitCost * r.units * 100) / 100,
      };
    });
    rows.sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({ ok: true, shop: shopParam, range: { from, to }, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
