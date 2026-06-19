import { NextResponse } from "next/server";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";
import { expenseId } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) {
      return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    }
    const { id, mkey, category, note, remember = true } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: "id ontbreekt" }, { status: 400 });

    const meta = await readJson("expense-meta.json", {});
    const cur = meta[id] || {};
    if (category !== undefined) cur.category = category;
    if (note !== undefined) cur.note = note;
    meta[id] = cur;
    await writeJson("expense-meta.json", meta);

    let learned = false;
    if (remember && category && mkey) {
      const rules: any[] = await readJson("expense-rules.json", []);
      const i = rules.findIndex((r) => r.key === mkey);
      if (i >= 0) rules[i].category = category;
      else rules.push({ key: mkey, category });
      await writeJson("expense-rules.json", rules);
      learned = true;
    }

    return NextResponse.json({ ok: true, learned });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    if (!persistenceEnabled()) {
      return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    }
    const { ids } = await req.json();
    const list: string[] = Array.isArray(ids) ? ids : [];
    if (!list.length) return NextResponse.json({ ok: false, error: "geen ids" }, { status: 400 });
    const del = new Set(list);

    // 1) markeer als verwijderd (werkt ook voor gecommitte regels en herhaalde imports)
    const meta = await readJson("expense-meta.json", {});
    for (const id of list) meta[id] = { ...(meta[id] || {}), deleted: true };
    await writeJson("expense-meta.json", meta);

    // 2) ruim geïmporteerde regels fysiek op
    const imported: any[] = await readJson("imported-expenses.json", []);
    const kept = imported.filter((e) => !del.has(expenseId(e)));
    if (kept.length !== imported.length) await writeJson("imported-expenses.json", kept);

    return NextResponse.json({ ok: true, deleted: list.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
