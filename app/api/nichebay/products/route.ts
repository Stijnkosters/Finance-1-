import { NextResponse } from "next/server";
import { nichebayConfigured, fetchNicheBayProductCosts } from "@/lib/nichebay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  if (!nichebayConfigured()) {
    return NextResponse.json({ ok: false, error: "NICHEBAY_API_KEY ontbreekt in env vars." }, { status: 400 });
  }
  try {
    const { products, ordersSeen, sampleOrder, sampleLine } = await fetchNicheBayProductCosts(30, 100);
    return NextResponse.json({ ok: true, ordersSeen, productCount: products.length, products, sampleOrder, sampleLine });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
