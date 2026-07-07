import { shopifyGraphQL } from "@/lib/shopify";
import { fetchNicheBayCurrentCosts, nbNormName, nichebayConfigured } from "@/lib/nichebay";
import { getShop } from "@/lib/shops";

const FEE_RATE = 0.018;
const FEE_FIXED = 0.25;

type MarginRow = {
  product: string;
  variant: string;
  sku: string;
  verkoop: number;
  cogs: number | null;
  fees: number | null;
  winst: number | null;
  margePct: number | null;
  breakevenRoas: number | null;
  orders: number;
  basis: string;
  bron: string; // hoe gematcht: variant-id / naam / geen
};

async function shopifyVariants(cfg: any) {
  const out: { productTitle: string; variantTitle: string; variantId: string; sku: string; price: number; status: string }[] = [];
  let after: string | null = null;
  for (let i = 0; i < 30; i++) {
    const q = `query($after:String){products(first:50,after:$after,sortKey:TITLE){pageInfo{hasNextPage endCursor} nodes{title status variants(first:50){nodes{title sku price legacyResourceId}}}}}`;
    const j: any = await shopifyGraphQL(q, { after }, cfg);
    const pd = j?.data?.products;
    if (!pd) break;
    for (const p of pd.nodes) {
      for (const v of p.variants.nodes) {
        out.push({
          productTitle: p.title,
          variantTitle: v.title === "Default Title" ? "" : v.title,
          variantId: String(v.legacyResourceId || ""),
          sku: v.sku || "",
          price: Number(v.price) || 0,
          status: p.status,
        });
      }
    }
    if (!pd.pageInfo.hasNextPage) break;
    after = pd.pageInfo.endCursor;
  }
  return out;
}

export async function computeProductMargins(shopId = "drivemax") {
  const cfg = getShop(shopId);
  if (!cfg) throw new Error("Onbekende shop.");
  if (!nichebayConfigured()) throw new Error("NICHEBAY_API_KEY ontbreekt.");

  const [{ byVariant, byName, ordersSeen }, variants] = await Promise.all([
    fetchNicheBayCurrentCosts(30, 100),
    shopifyVariants(cfg.shopify),
  ]);

  const rows: MarginRow[] = [];
  for (const v of variants) {
    if (v.price <= 0) continue; // sla cadeaukaarten/€0 varianten over
    let match: any = null;
    let bron = "geen";
    if (v.variantId && byVariant[v.variantId]) { match = byVariant[v.variantId]; bron = "variant-id"; }
    else {
      const n = nbNormName(v.productTitle);
      if (byName[n]) { match = byName[n]; bron = "naam"; }
    }
    const cogs = match ? match.cost : null;
    const fees = cogs != null ? Math.round((v.price * FEE_RATE + FEE_FIXED) * 100) / 100 : null;
    const winst = cogs != null && fees != null ? Math.round((v.price - cogs - fees) * 100) / 100 : null;
    const margePct = winst != null ? Math.round((winst / v.price) * 1000) / 10 : null;
    const breakevenRoas = winst != null && winst > 0 ? Math.round((v.price / winst) * 100) / 100 : null;
    rows.push({
      product: v.productTitle + (v.variantTitle ? ` – ${v.variantTitle}` : ""),
      variant: v.variantTitle,
      sku: v.sku,
      verkoop: v.price,
      cogs,
      fees,
      winst,
      margePct,
      breakevenRoas,
      orders: match ? match.orders : 0,
      basis: match ? match.basis : "",
      bron,
    });
  }
  // gematchte producten eerst, gesorteerd op break-even ROAS (hoog = kwetsbaar bovenaan)
  rows.sort((a, b) => {
    if ((a.cogs != null) !== (b.cogs != null)) return a.cogs != null ? -1 : 1;
    return (b.breakevenRoas ?? -1) - (a.breakevenRoas ?? -1);
  });
  return { generatedAt: new Date().toISOString(), shop: shopId, ordersSeen, count: rows.length, matched: rows.filter((r) => r.cogs != null).length, rows };
}
