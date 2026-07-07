import { NextResponse } from "next/server";
import { nichebayConfigured, nbCatalogProbe } from "@/lib/nichebay";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  if (!nichebayConfigured()) {
    return NextResponse.json({ ok: false, error: "NICHEBAY_API_KEY ontbreekt." }, { status: 400 });
  }
  try {
    const results = await nbCatalogProbe();
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
