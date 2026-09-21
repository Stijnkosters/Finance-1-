import { NextResponse } from "next/server";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

const FILE = "manual-expenses.json";

function uid() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function list(): Promise<any[]> {
  const raw = await readJson(FILE, []);
  return Array.isArray(raw) ? raw : [];
}

// Alle handmatige regels ophalen (nieuwste eerst)
export async function GET() {
  if (!persistenceEnabled()) return NextResponse.json({ ok: true, rows: [] });
  const rows = await list();
  return NextResponse.json({ ok: true, rows: rows.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")) });
}

// Regel toevoegen of bijwerken (op uid). Body: { uid?, date, omschrijving, methode, bedrag, category, beoordeling, note }
export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) {
      return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    }
    const b = await req.json();
    const date = String(b.date || "").trim();
    const bedrag = Number(b.bedrag);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: "Ongeldige datum (verwacht JJJJ-MM-DD)." }, { status: 400 });
    if (!isFinite(bedrag)) return NextResponse.json({ ok: false, error: "Ongeldig bedrag." }, { status: 400 });

    const row = {
      uid: b.uid || uid(),
      date,
      omschrijving: String(b.omschrijving || "").slice(0, 200),
      methode: String(b.methode || "").slice(0, 30),
      bedrag: Math.round(bedrag * 100) / 100,
      category: String(b.category || "Overig"),
      store: ["drivemax", "homivo", "algemeen"].includes(b.store) ? b.store : "algemeen",
      beoordeling: ["goed", "slecht", "nakijken"].includes(b.beoordeling) ? b.beoordeling : "",
      note: String(b.note || "").slice(0, 300),
      done: b.done === true,
    };

    const rows = await list();
    const i = rows.findIndex((r) => r.uid === row.uid);
    if (i >= 0) rows[i] = row; else rows.push(row);
    await writeJson(FILE, rows);
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// Regel(s) verwijderen. Body: { uid } of { uids: [...] }
export async function DELETE(req: Request) {
  try {
    if (!persistenceEnabled()) {
      return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    }
    const b = await req.json().catch(() => ({}));
    const del = new Set<string>([...(b.uid ? [b.uid] : []), ...(Array.isArray(b.uids) ? b.uids : [])]);
    if (!del.size) return NextResponse.json({ ok: false, error: "geen uid" }, { status: 400 });
    const rows = await list();
    const kept = rows.filter((r) => !del.has(r.uid));
    await writeJson(FILE, kept);
    return NextResponse.json({ ok: true, removed: rows.length - kept.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
