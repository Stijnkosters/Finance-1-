import { NextResponse } from "next/server";
import { nichebayConfigured, fetchNicheBayRefunds } from "@/lib/nichebay";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Supplier-refunds (NicheBay-credits bij retour). Voorlopig diagnose-endpoint:
// toont totaal + ruwe voorbeelden zodat we de veldnamen kunnen verifiëren.
export async function GET(req: Request) {
  if (!nichebayConfigured()) {
    return NextResponse.json({ ok: false, error: "NICHEBAY_API_KEY ontbreekt." }, { status: 400 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const toStr = searchParams.get("to");
    const fromStr = searchParams.get("from");
    const toSec = toStr ? Math.floor(new Date(toStr + "T23:59:59Z").getTime() / 1000) : Math.floor(Date.now() / 1000);
    const fromSec = fromStr ? Math.floor(new Date(fromStr + "T00:00:00Z").getTime() / 1000) : Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000);
    const r = await fetchNicheBayRefunds(fromSec, toSec);
    return NextResponse.json({ ok: true, range: { from: fromSec, to: toSec }, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
