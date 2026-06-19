import { NextResponse } from "next/server";
import { parseBankCsv, dedupKey } from "@/lib/bankparse";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";
import { decorate } from "@/lib/meta";

export const dynamic = "force-dynamic";

async function decoratedPending() {
  const pending = await readJson("pending-import.json", []);
  const meta = await readJson("expense-meta.json", {});
  const rules = await readJson("expense-rules.json", []);
  return decorate(pending, meta, rules).filter((e: any) => !e.deleted);
}

// Huidige wachtrij ophalen (zodat hij blijft staan na herladen)
export async function GET() {
  if (!persistenceEnabled()) return NextResponse.json({ ok: true, pending: [] });
  return NextResponse.json({ ok: true, pending: await decoratedPending() });
}

// Importeren -> in de wachtrij zetten (nog NIET meegeteld)
export async function POST(req: Request) {
  try {
    const source = new URL(req.url).searchParams.get("source") || "rabobank";
    const body = await req.text();
    if (!body || body.length < 10) {
      return NextResponse.json({ ok: false, error: "Leeg of ongeldig bestand." }, { status: 400 });
    }
    const { expenses, stats, source: sourceName } = parseBankCsv(body, source);

    let staged = 0, duplicates = 0;
    if (persistenceEnabled() && expenses.length) {
      const pending: any[] = await readJson("pending-import.json", []);
      const imported: any[] = await readJson("imported-expenses.json", []);
      const seen = new Set([...pending, ...imported].map(dedupKey));
      const toAdd = expenses.filter((e) => {
        const k = dedupKey(e);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      duplicates = expenses.length - toAdd.length;
      if (toAdd.length) await writeJson("pending-import.json", [...pending, ...toAdd]);
      staged = toAdd.length;
    }

    return NextResponse.json({
      ok: true,
      source: sourceName,
      parsed: expenses.length,
      staged,
      duplicates,
      persisted: persistenceEnabled(),
      stats,
      pending: persistenceEnabled() ? await decoratedPending() : [],
      note: !persistenceEnabled()
        ? "Geen opslag actief: voeg een Railway Volume toe en zet DATA_DIR, anders wordt de import niet bewaard."
        : expenses.length === 0
        ? "Geen uitgaven herkend. Stuur me één voorbeeldregel uit je CSV als de kolommen niet kloppen."
        : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// ?what=pending -> verwerp de wachtrij | anders -> wis goedgekeurde import
export async function DELETE(req: Request) {
  try {
    if (!persistenceEnabled()) {
      return NextResponse.json({ ok: false, error: "Geen opslag actief." }, { status: 400 });
    }
    const what = new URL(req.url).searchParams.get("what");
    if (what === "pending") await writeJson("pending-import.json", []);
    else await writeJson("imported-expenses.json", []);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
