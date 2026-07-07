import { NextResponse } from "next/server";
import { computeProductMargins, applyOverrides } from "@/lib/productMargins";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;
const KEY = "product-margins-v2.json"; // nieuwe key → negeert oude cache, berekent 1x vers

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  let cache: any = null;
  try { cache = await readJson(KEY, null); } catch { cache = null; }
  const ageH = cache?.generatedAt ? (Date.now() - new Date(cache.generatedAt).getTime()) / 3600000 : Infinity;

  if (cache && !force) {
    if (ageH >= 12 && !running && persistenceEnabled()) {
      running = true;
      (async () => { try { const d = await computeProductMargins(); await writeJson(KEY, d); } catch {} finally { running = false; } })();
    }
    // overrides live toepassen op de gecachte basis-data
    return NextResponse.json({ ...applyOverrides(cache), cached: true, ageHours: Math.round(ageH * 10) / 10 });
  }

  try {
    const base = await computeProductMargins();
    if (persistenceEnabled()) { try { await writeJson(KEY, base); } catch {} }
    return NextResponse.json({ ...applyOverrides(base), cached: false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
