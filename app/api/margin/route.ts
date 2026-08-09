import { NextResponse } from "next/server";
import { computePL } from "@/lib/pl";

// ============================================================
// Machine-endpoint voor ADSGUARD: geeft alleen de marge-cijfers
// (contributiemarge % + break-even ROAS) per shop. Beveiligd met
// een gedeelde secret (FINANCE_API_SECRET) via header x-finance-secret
// of ?secret=. Zonder gezette secret is het open (zet 'm dus!).
// Het publieke /api/pl (dashboard) blijft ongewijzigd.
// ============================================================

export const dynamic = "force-dynamic";
export const revalidate = 0;

function authorized(req: Request): boolean {
  const expected = process.env.FINANCE_API_SECRET;
  if (!expected) return true; // niet geconfigureerd → open (aanrader: zetten)
  const url = new URL(req.url);
  const provided = req.headers.get("x-finance-secret") || url.searchParams.get("secret");
  return provided === expected;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const defFrom = new Date(); defFrom.setDate(defFrom.getDate() - 30);
    const from = searchParams.get("from") || defFrom.toISOString().slice(0, 10);
    const shopParam = searchParams.get("shop") || "drivemax";

    const result = await computePL(shopParam, from, to);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    const t = result.totals;
    return NextResponse.json({
      ok: true,
      shop: result.shop,
      range: result.range,
      // marge als fractie (0.42) én als %; break-even ROAS als ratio
      marginPct: t.marginPct > 0 ? t.marginPct / 100 : 0,
      marginPctDisplay: t.marginPct,
      netMarginPct: t.netMarginPct / 100,
      breakevenRoas: t.breakevenRoas,
      contributionMargin: t.contributionMargin,
      maxCpa: t.maxCpa,
      omzet: t.omzet,
      cogs: t.cogs,
      fees: t.fees,
      refunds: t.refunds,
      adspend: t.adspend,
      orders: t.orders,
      cogsSource: result.cogsSource,
      // let op: 0 kostprijzen ⇒ marge overschat. Deze vlag helpt ADSGUARD.
      cogsMissing: (result.missingCosts || []).length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
