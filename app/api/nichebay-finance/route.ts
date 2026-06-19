import { NextResponse } from "next/server";
import { nichebayConfigured, nbFinancesSample } from "@/lib/nichebay";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!nichebayConfigured()) {
    return NextResponse.json({ ok: false, error: "NICHEBAY_API_KEY ontbreekt." }, { status: 400 });
  }
  try {
    const fin = await nbFinancesSample(20);
    return NextResponse.json({ ok: true, ...fin });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
