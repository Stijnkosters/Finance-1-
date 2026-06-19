import { NextResponse } from "next/server";
import { fetchOrders } from "@/lib/shopify";
import { resolveAdSpend } from "@/lib/adspend";
import { nichebayConfigured, fetchNicheBayCostByOrder } from "@/lib/nichebay";
import costsData from "@/data/costs.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const costs: Record<string, { title: string; price: number; cost: number }> = (costsData as any).costs || {};
const FEE_RATE = parseFloat(process.env.FEE_RATE || "0.018");
const FEE_FIXED = parseFloat(process.env.FEE_FIXED || "0.25");

function dayKeyAmsterdam(iso: string) {
  // Zet UTC-timestamp om naar de datum in Europe/Amsterdam (matcht je Shopify-tijdzone)
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts; // YYYY-MM-DD
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const defFrom = new Date();
    defFrom.setDate(defFrom.getDate() - 30);
    const from = searchParams.get("from") || defFrom.toISOString().slice(0, 10);

    const orders = await fetchOrders(from, to);
    const adRes = await resolveAdSpend(from, to);
    const adspend = adRes.map;

    // COGS-bron: NicheBay (op ordernummer) met costs.json als fallback
    let nbMap: Record<string, number> = {};
    let cogsSource = "costs.json";
    let cogsWarning: string | null = null;
    if (nichebayConfigured()) {
      try {
        const r = await fetchNicheBayCostByOrder();
        nbMap = r.map;
        cogsSource = "nichebay";
      } catch (e: any) {
        cogsWarning = `NicheBay-koppeling faalde (${e.message}). Val terug op costs.json.`;
      }
    }
    let nbMatched = 0;

    const byDay: Record<string, any> = {};
    let unmatched: Record<string, { title: string; units: number }> = {};

    for (const o of orders) {
      const day = dayKeyAmsterdam(o.createdAt);
      if (!byDay[day]) byDay[day] = { date: day, orders: 0, units: 0, revenue: 0, refunds: 0, cogs: 0 };
      const bucket = byDay[day];
      bucket.orders += 1;
      bucket.revenue += parseFloat(o.totalPriceSet?.shopMoney?.amount || o.subtotalPriceSet?.shopMoney?.amount || "0");
      bucket.refunds += parseFloat(o.totalRefundedSet?.shopMoney?.amount || "0");

      // Match deze Shopify-order op NicheBay-kostprijs (ordernummer of order-ID)
      const orderNo = String(o.name || "").replace(/^#/, "").trim();
      const numId = String(o.id || "").split("/").pop() || "";
      const nbCost = nbMap[orderNo] ?? (numId ? nbMap[numId] : undefined);
      const hasNb = nbCost != null;
      if (hasNb) nbMatched += 1;

      let lineCogs = 0;
      for (const li of o.lineItems?.nodes || []) {
        const vid = li.variant?.id;
        const qty = li.quantity || 0;
        bucket.units += qty;
        const c = vid ? costs[vid] : null;
        if (c) {
          lineCogs += qty * (c.cost || 0);
        } else if (vid && !hasNb) {
          if (!unmatched[vid]) unmatched[vid] = { title: li.title, units: 0 };
          unmatched[vid].units += qty;
        }
      }
      // NicheBay-kost heeft voorrang; anders costs.json
      bucket.cogs += hasNb ? nbCost : lineCogs;
    }

    const days = Object.values(byDay)
      .map((d: any) => {
        const fees = d.revenue * FEE_RATE + d.orders * FEE_FIXED;
        const ad = adspend[d.date] || 0;
        const grossProfit = d.revenue - d.cogs;
        const totalProfit = d.revenue - d.cogs - ad - d.refunds - fees;
        const roas = ad > 0 ? d.revenue / ad : 0;
        return {
          ...d,
          fees: round(fees),
          adspend: round(ad),
          grossProfit: round(grossProfit),
          totalProfit: round(totalProfit),
          roas: round(roas),
          revenue: round(d.revenue),
          refunds: round(d.refunds),
          cogs: round(d.cogs),
        };
      })
      .sort((a: any, b: any) => a.date.localeCompare(b.date));

    const totals = days.reduce(
      (t: any, d: any) => {
        t.orders += d.orders; t.units += d.units; t.revenue += d.revenue;
        t.refunds += d.refunds; t.cogs += d.cogs; t.fees += d.fees;
        t.adspend += d.adspend; t.totalProfit += d.totalProfit;
        return t;
      },
      { orders: 0, units: 0, revenue: 0, refunds: 0, cogs: 0, fees: 0, adspend: 0, totalProfit: 0 }
    );
    Object.keys(totals).forEach((k) => (totals[k] = round(totals[k])));

    const missingCosts = Object.entries(costs)
      .filter(([, c]) => !c.cost)
      .map(([id, c]) => ({ id, title: c.title }));

    return NextResponse.json({
      ok: true,
      range: { from, to },
      days,
      totals,
      adSource: adRes.source,
      adWarning: adRes.warning,
      cogsSource,
      cogsWarning,
      nbMatched,
      orderCount: orders.length,
      missingCosts,
      unmatched: Object.entries(unmatched).map(([id, v]) => ({ id, ...v })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

function round(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
