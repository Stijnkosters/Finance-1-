import { NextResponse } from "next/server";
import { nichebayConfigured, nbTest, fetchNicheBayCostByOrder } from "@/lib/nichebay";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!nichebayConfigured()) {
    return NextResponse.json({ ok: false, error: "NICHEBAY_API_KEY ontbreekt in env vars." }, { status: 400 });
  }
  try {
    let test: any = null;
    try { test = await nbTest(); } catch (e: any) { test = { error: e.message }; }
    const { map, sample } = await fetchNicheBayCostByOrder(3, 50);
    return NextResponse.json({
      ok: true,
      test,
      sampleOrder: sample,          // ruw eerste order-object: hierin staan de echte veldnamen
      matchedOrders: Object.keys(map).length,
      sampleMap: Object.fromEntries(Object.entries(map).slice(0, 10)),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
