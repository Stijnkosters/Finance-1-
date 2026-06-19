import { NextResponse } from "next/server";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

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
