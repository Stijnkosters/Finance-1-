import { NextResponse } from "next/server";
import { nichebayConfigured, fetchNicheBayRefunds, nbRefundProbe } from "@/lib/nichebay";

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
    const fromSec = fromStr ? Math.floor(new Date(fromStr + "T00:00:00Z").getTime() / 1000) : Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    if (searchParams.get("probe")) {
      // probe met een veilig 7-daags venster
      const probe = await nbRefundProbe(toSec - 7 * 24 * 3600, toSec);
      return NextResponse.json({ ok: true, probe });
    }
    const r = await fetchNicheBayRefunds(fromSec, toSec);
    return NextResponse.json({ ok: true, range: { from: fromSec, to: toSec }, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
