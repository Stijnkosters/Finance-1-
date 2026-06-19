import { NextResponse } from "next/server";
import { parseBankCsv, dedupKey } from "@/lib/bankparse";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";
import { expenseId } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const source = new URL(req.url).searchParams.get("source") || "rabobank";
    const body = await req.text();
    if (!body || body.length < 10) {
      return NextResponse.json({ ok: false, error: "Leeg of ongeldig bestand." }, { status: 400 });
    }
    const { expenses, stats, header, source: sourceName } = parseBankCsv(body, source);

    let saved = 0, duplicates = 0, revived = 0;
    if (persistenceEnabled() && expenses.length) {
      // 1) eerder verwijderde regels die nu opnieuw geïmporteerd worden weer terugzetten
      const meta = await readJson("expense-meta.json", {});
      let metaChanged = false;
      for (const e of expenses) {
        const id = expenseId(e);
        if (meta[id]?.deleted) { meta[id].deleted = false; revived++; metaChanged = true; }
      }
      if (metaChanged) await writeJson("expense-meta.json", meta);

      // 2) nieuwe regels toevoegen (dubbele overslaan)
      const existing: any[] = await readJson("imported-expenses.json", []);
      const seen = new Set(existing.map(dedupKey));
      const toAdd = expenses.filter((e) => {
        const k = dedupKey(e);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      duplicates = expenses.length - toAdd.length;
      if (toAdd.length) await writeJson("imported-expenses.json", [...existing, ...toAdd]);
      saved = toAdd.length;
    }

    return NextResponse.json({
      ok: true,
      source: sourceName,
      parsed: expenses.length,
      saved,
      duplicates,
      revived,
      persisted: persistenceEnabled(),
      stats,
      header,
      preview: expenses.slice(0, 25),
      note: !persistenceEnabled()
        ? "Geen opslag actief: voeg een Railway Volume toe en zet DATA_DIR, anders wordt de import niet bewaard."
        : expenses.length === 0
        ? "Geen uitgaven herkend. Stuur me één voorbeeldregel uit je CSV als de kolommen niet kloppen."
        : revived > 0
        ? `${revived} eerder verwijderde regel(s) teruggezet.`
        : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// Verwijder alle geïmporteerde uitgaven (reset)
export async function DELETE() {
  try {
    if (persistenceEnabled()) await writeJson("imported-expenses.json", []);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
