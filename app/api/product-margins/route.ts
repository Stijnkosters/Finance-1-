import { NextResponse } from "next/server";
import { computeProductMargins } from "@/lib/productMargins";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;
const KEY = "product-margins.json";

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
    return NextResponse.json({ ...cache, cached: true, ageHours: Math.round(ageH * 10) / 10 });
  }

  try {
    const data = await computeProductMargins();
    if (persistenceEnabled()) { try { await writeJson(KEY, data); } catch {} }
    return NextResponse.json({ ...data, cached: false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
