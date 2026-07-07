import { NextResponse } from "next/server";
import { fetchOrders } from "@/lib/shopify";
import { resolveAdSpend } from "@/lib/adspend";
import { nichebayConfigured, fetchNicheBayCostByOrder } from "@/lib/nichebay";
import { SHOPS, getShop, shopConfigured, type ShopCfg } from "@/lib/shops";
import costsDrivemax from "@/data/costs.json";
import costsHomivo from "@/data/costs-homivo.json";
import { maybeAutoSyncBing } from "@/lib/bingSync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COSTS_BY_KEY: Record<string, Record<string, { title: string; price: number; cost: number }>> = {
  drivemax: (costsDrivemax as any).costs || {},
  homivo: (costsHomivo as any).costs || {},
};
const FEE_RATE = parseFloat(process.env.FEE_RATE || "0.018");
const FEE_FIXED = parseFloat(process.env.FEE_FIXED || "0.25");

function dayKeyAmsterdam(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function round(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type Bucket = { date: string; orders: number; units: number; revenue: number; refunds: number; cogs: number };

// Verzamelt de ruwe per-dag cijfers voor één shop (zonder overhead)
async function gatherShop(shop: ShopCfg, from: string, to: string) {
  const costs = COSTS_BY_KEY[shop.costsKey] || {};
  const orders = await fetchOrders(from, to, shop.shopify);
  const adRes = await resolveAdSpend(from, to, shop.ads);
  const adspend = adRes.map;

  let nbMap: Record<string, number> = {};
  let cogsSource = "costs.json";
  let cogsWarning: string | null = null;
  if (shop.nichebay && nichebayConfigured()) {
    try { const r = await fetchNicheBayCostByOrder(); nbMap = r.map; cogsSource = "nichebay"; }
    catch (e: any) { cogsWarning = `NicheBay-koppeling faalde (${e.message}). Val terug op costs.json.`; }
  }

  let nbMatched = 0, nbZero = 0, ordersNoCost = 0;
  const byDay: Record<string, Bucket> = {};
  const unmatched: Record<string, { title: string; units: number }> = {};
  const custStats: Record<string, { orders: number; revenue: number }> = {};

  for (const o of orders) {
    const day = dayKeyAmsterdam(o.createdAt);
    if (!byDay[day]) byDay[day] = { date: day, orders: 0, units: 0, revenue: 0, refunds: 0, cogs: 0 };
    const bucket = byDay[day];
    bucket.orders += 1;
    const orderRev = parseFloat(o.totalPriceSet?.shopMoney?.amount || o.subtotalPriceSet?.shopMoney?.amount || "0");
    bucket.revenue += orderRev;
    bucket.refunds += parseFloat(o.totalRefundedSet?.shopMoney?.amount || "0");

    const custId = o.customer?.id || `${shop.id}:guest:${o.id}`;
    if (!custStats[custId]) custStats[custId] = { orders: 0, revenue: 0 };
    custStats[custId].orders += 1;
    custStats[custId].revenue += orderRev;

    const orderNo = String(o.name || "").replace(/^#/, "").trim();
    const numId = String(o.id || "").split("/").pop() || "";
    const nbCost = nbMap[orderNo] ?? (numId ? nbMap[numId] : undefined);
    const hasNb = nbCost != null && nbCost > 0;
    if (hasNb) nbMatched += 1;
    else if (nbCost != null) nbZero += 1;

    let lineCogs = 0;
    let lineCovered = true;
    for (const li of o.lineItems?.nodes || []) {
      const vid = li.variant?.id;
      const qty = li.quantity || 0;
      bucket.units += qty;
      const c = vid ? costs[vid] : null;
      if (c) lineCogs += qty * (c.cost || 0);
      else if (vid && !hasNb) {
        lineCovered = false;
        if (!unmatched[vid]) unmatched[vid] = { title: li.title, units: 0 };
        unmatched[vid].units += qty;
      }
    }
    bucket.cogs += hasNb ? nbCost! : lineCogs;
    if (!hasNb && !lineCovered) ordersNoCost += 1;
  }

  const missingCosts = Object.entries(costs).filter(([, c]) => !c.cost).map(([id, c]) => ({ id, title: c.title }));

  return {
    byDay, custStats, adspend, adRes,
    cogsSource, cogsWarning, nbMatched, nbZero, ordersNoCost,
    orderCount: orders.length,
    unmatched: Object.entries(unmatched).map(([id, v]) => ({ id, ...v })),
    missingCosts,
  };
}

// Bouwt days[] + totals[] uit ruwe buckets + adspend + klantstats
function finalize(byDay: Record<string, Bucket>, adspend: Record<string, number>, custStats: Record<string, { orders: number; revenue: number }>) {
  const days = Object.values(byDay).map((d) => {
    const fees = d.revenue * FEE_RATE + d.orders * FEE_FIXED;
    const ad = adspend[d.date] || 0;
    const grossProfit = d.revenue - d.cogs;
    const totalProfit = d.revenue - d.cogs - ad - d.refunds - fees;
    const roas = ad > 0 ? d.revenue / ad : 0;
    return {
      ...d,
      fees: round(fees), adspend: round(ad),
      grossProfit: round(grossProfit), totalProfit: round(totalProfit),
      roas: round(roas), revenue: round(d.revenue), refunds: round(d.refunds), cogs: round(d.cogs),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));

  const totals: any = days.reduce((t, d) => {
    t.orders += d.orders; t.units += d.units; t.revenue += d.revenue;
    t.refunds += d.refunds; t.cogs += d.cogs; t.fees += d.fees;
    t.adspend += d.adspend; t.totalProfit += d.totalProfit;
    return t;
  }, { orders: 0, units: 0, revenue: 0, refunds: 0, cogs: 0, fees: 0, adspend: 0, totalProfit: 0 });
  Object.keys(totals).forEach((k) => (totals[k] = round(totals[k])));

  const contrib = totals.revenue - totals.cogs - totals.fees - totals.refunds;
  totals.contributionMargin = round(contrib);
  totals.marginPct = totals.revenue > 0 ? round((contrib / totals.revenue) * 100) : 0;
  totals.roas = totals.adspend > 0 ? round(totals.revenue / totals.adspend) : 0;
  totals.breakevenRoas = contrib > 0 ? round(totals.revenue / contrib) : 0;

  const O = totals.orders || 0;
  totals.aov = O > 0 ? round(totals.revenue / O) : 0;
  totals.profitPerOrder = O > 0 ? round(totals.totalProfit / O) : 0;
  totals.cacPerOrder = O > 0 ? round(totals.adspend / O) : 0;
  totals.maxCpa = O > 0 ? round(contrib / O) : 0;
  totals.refundRate = totals.revenue > 0 ? round((totals.refunds / totals.revenue) * 100) : 0;

  const custIds = Object.keys(custStats);
  const uniqueCustomers = custIds.length;
  const repeatCustomers = custIds.filter((k) => custStats[k].orders > 1).length;
  totals.uniqueCustomers = uniqueCustomers;
  totals.repeatRate = uniqueCustomers > 0 ? round((repeatCustomers / uniqueCustomers) * 100) : 0;
  totals.ordersPerCustomer = uniqueCustomers > 0 ? round(O / uniqueCustomers) : 0;
  totals.revenuePerCustomer = uniqueCustomers > 0 ? round(totals.revenue / uniqueCustomers) : 0;
  const marginRatio = totals.revenue > 0 ? contrib / totals.revenue : 0;
  totals.ltv = uniqueCustomers > 0 ? round((totals.revenue / uniqueCustomers) * marginRatio) : 0;

  return { days, totals };
}

export async function GET(req: Request) {
  try {
    void maybeAutoSyncBing(); // ververst Bing-cache op de achtergrond als 'ie ouder is dan 8u
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const defFrom = new Date(); defFrom.setDate(defFrom.getDate() - 30);
    const from = searchParams.get("from") || defFrom.toISOString().slice(0, 10);
    const shopParam = searchParams.get("shop") || "drivemax";

    // Welke shops draaien we? "totaal" = alle geconfigureerde shops samengeteld
    const targets: ShopCfg[] =
      shopParam === "totaal" ? SHOPS.filter(shopConfigured) : [getShop(shopParam)];

    if (!targets.length || (shopParam !== "totaal" && !shopConfigured(targets[0]))) {
      return NextResponse.json({
        ok: false,
        error: `Shop "${shopParam}" heeft nog geen Shopify-credentials. Zet de bijbehorende env-variabelen in Railway.`,
      }, { status: 400 });
    }

    // Verzamel per shop, dan samenvoegen
    const mergedByDay: Record<string, Bucket> = {};
    const mergedAd: Record<string, number> = {};
    const mergedCust: Record<string, { orders: number; revenue: number }> = {};
    const breakdown = { google: 0, bing: 0, manual: 0 };
    const adSources: string[] = [];
    const perShop: any[] = [];
    let nbMatched = 0, nbZero = 0, ordersNoCost = 0, orderCount = 0;
    let cogsSource = "", cogsWarning: string | null = null, adWarning: string | null = null;
    let unmatched: any[] = [];
    let missingCosts: any[] = [];

    for (const shop of targets) {
      const g = await gatherShop(shop, from, to);
      for (const [d, b] of Object.entries(g.byDay)) {
        if (!mergedByDay[d]) mergedByDay[d] = { date: d, orders: 0, units: 0, revenue: 0, refunds: 0, cogs: 0 };
        const t = mergedByDay[d];
        t.orders += b.orders; t.units += b.units; t.revenue += b.revenue; t.refunds += b.refunds; t.cogs += b.cogs;
      }
      for (const [d, v] of Object.entries(g.adspend)) mergedAd[d] = (mergedAd[d] || 0) + v;
      for (const [k, v] of Object.entries(g.custStats)) {
        if (!mergedCust[k]) mergedCust[k] = { orders: 0, revenue: 0 };
        mergedCust[k].orders += v.orders; mergedCust[k].revenue += v.revenue;
      }
      breakdown.google += g.adRes.breakdown.google;
      breakdown.bing += g.adRes.breakdown.bing;
      breakdown.manual += g.adRes.breakdown.manual;
      if (g.adRes.source && g.adRes.source !== "manual") adSources.push(`${shop.name}: ${g.adRes.source}`);
      nbMatched += g.nbMatched; nbZero += g.nbZero; ordersNoCost += g.ordersNoCost; orderCount += g.orderCount;
      cogsSource = cogsSource ? cogsSource : g.cogsSource;
      if (g.cogsWarning) cogsWarning = (cogsWarning ? cogsWarning + " " : "") + `[${shop.name}] ${g.cogsWarning}`;
      if (g.adRes.warning) adWarning = (adWarning ? adWarning + " " : "") + `[${shop.name}] ${g.adRes.warning}`;
      unmatched = unmatched.concat(g.unmatched.map((u: any) => ({ ...u, shop: shop.name })));
      missingCosts = missingCosts.concat(g.missingCosts.map((m: any) => ({ ...m, shop: shop.name })));

      // mini-samenvatting per shop voor het Totaal-overzicht
      const fin = finalize(g.byDay, g.adspend, g.custStats);
      perShop.push({ id: shop.id, name: shop.name, totals: fin.totals });
    }

    const { days, totals } = finalize(mergedByDay, mergedAd, mergedCust);

    return NextResponse.json({
      ok: true,
      shop: shopParam,
      range: { from, to },
      days,
      totals,
      perShop,
      adSource: adSources.join(" · ") || "manual",
      adBreakdown: breakdown,
      adWarning,
      cogsSource,
      cogsWarning,
      nbMatched, nbZero, ordersNoCost,
      orderCount,
      missingCosts,
      unmatched,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
