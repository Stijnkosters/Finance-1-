import { NextResponse } from "next/server";
import { fetchOrders } from "@/lib/shopify";
import { nichebayConfigured, fetchNicheBayCostByOrder } from "@/lib/nichebay";
import { getShop } from "@/lib/shops";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FEE_RATE = 0.018;
const FEE_FIXED = 0.25;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const defFrom = new Date(); defFrom.setDate(defFrom.getDate() - 30);
    const from = searchParams.get("from") || defFrom.toISOString().slice(0, 10);
    const shopId = searchParams.get("shop") || "drivemax";
    const cfg = getShop(shopId);
    if (!cfg) return NextResponse.json({ error: "Onbekende shop." }, { status: 400 });

    let nbMap: Record<string, number> = {};
    if (nichebayConfigured()) { try { nbMap = (await fetchNicheBayCostByOrder()).map; } catch {} }

    const orders = await fetchOrders(from, to, cfg.shopify);
    const rows = orders.map((o: any) => {
      const orderNo = String(o.name || "").replace(/^#/, "").trim();
      const numId = orderNo.replace(/\D/g, "");
      const revenue = Number(o.totalPriceSet?.shopMoney?.amount || 0);
      const refunds = Number(o.totalRefundedSet?.shopMoney?.amount || 0);
      const cogs = nbMap[orderNo] ?? (numId ? nbMap[numId] : undefined) ?? null;
      const fees = Math.round((revenue * FEE_RATE + FEE_FIXED) * 100) / 100;
      const c = cogs ?? 0;
      const winst = Math.round((revenue - c - fees - refunds) * 100) / 100;
      const cm = revenue - c - fees - refunds; // dekkingsbijdrage vóór ad
      const breakevenRoas = cm > 0 ? Math.round((revenue / cm) * 100) / 100 : null;
      const margePct = revenue > 0 ? Math.round((winst / revenue) * 1000) / 10 : null;
      const items = (o.lineItems?.nodes || []).map((li: any) => `${li.quantity}× ${li.title}`).join(", ");
      return {
        order: o.name, date: String(o.createdAt || "").slice(0, 10),
        revenue: Math.round(revenue * 100) / 100,
        refunds: Math.round(refunds * 100) / 100,
        cogs: cogs != null ? Math.round(cogs * 100) / 100 : null,
        fees, winst, margePct, breakevenRoas, items,
      };
    });
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.order < b.order ? 1 : -1)));

    const t = rows.reduce((acc, r) => {
      acc.revenue += r.revenue; acc.refunds += r.refunds; acc.cogs += r.cogs || 0; acc.fees += r.fees; acc.winst += r.winst;
      return acc;
    }, { revenue: 0, refunds: 0, cogs: 0, fees: 0, winst: 0 });
    const totals = {
      orders: rows.length,
      revenue: Math.round(t.revenue * 100) / 100,
      refunds: Math.round(t.refunds * 100) / 100,
      cogs: Math.round(t.cogs * 100) / 100,
      fees: Math.round(t.fees * 100) / 100,
      winst: Math.round(t.winst * 100) / 100,
      breakevenRoas: (t.revenue - t.cogs - t.fees - t.refunds) > 0 ? Math.round((t.revenue / (t.revenue - t.cogs - t.fees - t.refunds)) * 100) / 100 : null,
    };
    return NextResponse.json({ ok: true, shop: shopId, from, to, count: rows.length, totals, rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
