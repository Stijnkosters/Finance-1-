import { NextResponse } from "next/server";
import { computePL } from "@/lib/pl";
import { maybeAutoSyncBing } from "@/lib/bingSync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    void maybeAutoSyncBing(); // ververst Bing-cache op de achtergrond als 'ie ouder is dan 8u
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const defFrom = new Date(); defFrom.setDate(defFrom.getDate() - 30);
    const from = searchParams.get("from") || defFrom.toISOString().slice(0, 10);
    const shopParam = searchParams.get("shop") || "drivemax";

    const result = await computePL(shopParam, from, to);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
