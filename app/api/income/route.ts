import { NextResponse } from "next/server";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST { id, category?, label? } = sla een override op voor een inkomende regel
export async function POST(req: Request) {
  if (!persistenceEnabled()) return NextResponse.json({ ok: false, error: "Geen opslag actief." }, { status: 400 });
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ ok: false, error: "id ontbreekt." }, { status: 400 });
    const meta: Record<string, any> = await readJson("income-meta.json", {});
    meta[body.id] = { ...(meta[body.id] || {}), ...(body.category != null ? { category: body.category } : {}), ...(body.label != null ? { label: body.label } : {}) };
    await writeJson("income-meta.json", meta);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
