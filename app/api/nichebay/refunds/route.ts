import { NextResponse } from "next/server";
import { nichebayConfigured, fetchNicheBayRefunds } from "@/lib/nichebay";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Supplier-refunds (NicheBay-credits bij retour). Voorlopig diagnose-endpoint:
// toont totaal + ruwe voorbeelden zodat we de veldnamen kunnen verifiëren.
export async function GET() {
  if (!nichebayConfigured()) {
    return NextResponse.json({ ok: false, error: "NICHEBAY_API_KEY ontbreekt." }, { status: 400 });
  }
  try {
    const r = await fetchNicheBayRefunds();
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
