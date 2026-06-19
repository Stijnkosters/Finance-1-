import { NextResponse } from "next/server";
import { dedupKey } from "@/lib/bankparse";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";
import { expenseId } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) {
      return NextResponse.json({ ok: false, error: "Geen opslag actief." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const idSet = Array.isArray(body.ids) && body.ids.length ? new Set(body.ids) : null;

    const pending: any[] = await readJson("pending-import.json", []);
    if (!pending.length) return NextResponse.json({ ok: true, approved: 0 });

    // selectie bepalen (per regel) of alles
    const toApprove = idSet ? pending.filter((e) => idSet.has(expenseId(e))) : pending;
    const remaining = idSet ? pending.filter((e) => !idSet.has(expenseId(e))) : [];
    if (!toApprove.length) return NextResponse.json({ ok: true, approved: 0 });

    // eerder verwijderde regels weer terugzetten
    const meta = await readJson("expense-meta.json", {});
    let metaChanged = false, revived = 0;
    for (const e of toApprove) {
      const id = expenseId(e);
      if (meta[id]?.deleted) { meta[id].deleted = false; revived++; metaChanged = true; }
    }
    if (metaChanged) await writeJson("expense-meta.json", meta);

    // naar definitieve import, dubbele overslaan
    const imported: any[] = await readJson("imported-expenses.json", []);
    const seen = new Set(imported.map(dedupKey));
    const toAdd = toApprove.filter((e) => {
      const k = dedupKey(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (toAdd.length) await writeJson("imported-expenses.json", [...imported, ...toAdd]);
    await writeJson("pending-import.json", remaining);

    return NextResponse.json({ ok: true, approved: toAdd.length, revived, remaining: remaining.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
