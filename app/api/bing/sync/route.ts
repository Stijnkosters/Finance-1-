import { NextResponse } from "next/server";
import { fetchBingSpendByDay, bingApiConfigured } from "@/lib/bingAds";
import { writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  if (!bingApiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Bing API niet volledig ingesteld. Vereist: BING_REFRESH_TOKEN, BING_DEVELOPER_TOKEN, BING_ACCOUNT_ID, BING_CUSTOMER_ID, BING_CLIENT_ID, BING_CLIENT_SECRET." },
      { status: 400 }
    );
  }
  if (!persistenceEnabled()) {
    return NextResponse.json(
      { ok: false, error: "DATA_DIR niet ingesteld — voeg een Railway Volume toe zodat de cache bewaard blijft." },
      { status: 400 }
    );
  }
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 95, 1), 400);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);

    const map = await fetchBingSpendByDay(ymd(from), ymd(to));
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    const payload = { updatedAt: new Date().toISOString(), from: ymd(from), to: ymd(to), map };
    await writeJson("bingspend.json", payload);

    return NextResponse.json({
      ok: true,
      updatedAt: payload.updatedAt,
      dagen: Object.keys(map).length,
      totaal: Math.round(total * 100) / 100,
      van: payload.from,
      tot: payload.to,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Bing sync faalde: ${e.message}` }, { status: 500 });
  }
}
