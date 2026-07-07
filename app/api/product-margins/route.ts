import { NextResponse } from "next/server";
import { computeProductMargins } from "@/lib/productMargins";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

function cacheKey(shop: string) {
  return `product-margins-${shop}.json`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop") || "drivemax";
  const force = url.searchParams.get("refresh") === "1";
  const key = cacheKey(shop);

  // cache lezen
  let cache: any = null;
  try { cache = await readJson(key, null); } catch { cache = null; }
  const ageH = cache?.generatedAt ? (Date.now() - new Date(cache.generatedAt).getTime()) / 3600000 : Infinity;

  // vers genoeg? geef cache terug + ververs op achtergrond bij >12u
  if (cache && !force) {
    if (ageH >= 12 && !running && persistenceEnabled()) {
      running = true;
      (async () => { try { const d = await computeProductMargins(shop); await writeJson(key, d); } catch {} finally { running = false; } })();
    }
    return NextResponse.json({ ...cache, cached: true, ageHours: Math.round(ageH * 10) / 10 });
  }

  // geen cache of geforceerd: nu berekenen
  try {
    const data = await computeProductMargins(shop);
    if (persistenceEnabled()) { try { await writeJson(key, data); } catch {} }
    return NextResponse.json({ ...data, cached: false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
