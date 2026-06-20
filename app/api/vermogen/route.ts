import { NextResponse } from "next/server";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

// Handmatige vermogenssheet: jij vult zelf in, kiest zelf de datum, drukt zelf op opslaan.
// CSV-imports raken dit NIET — die zijn alleen voor Overzicht / Netto P&L.
const SEED = {
  assets: [
    { name: "Rabobank zakelijk", amount: 0 },
    { name: "Wise", amount: 0 },
    { name: "Revolut", amount: 0 },
    { name: "PayPal", amount: 0 },
    { name: "Shopify uit te betalen", amount: 0 },
    { name: "NicheBay saldo", amount: 0 },
  ],
  liabilities: [
    { name: "American Express", amount: 0 },
    { name: "Rabo creditcard", amount: 0 },
    { name: "BTW-reservering", amount: 0 },
    { name: "Openstaande facturen", amount: 0 },
  ],
  date: "",
  snapshots: [] as any[],
};

const sum = (rows: any[]) => (rows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const todayStr = () => new Date().toISOString().slice(0, 10);

export async function GET() {
  const v = (await readJson("vermogen.json", null)) || SEED;
  const assets = v.assets || [];
  const liabilities = v.liabilities || [];
  const snapshots = (v.snapshots || []).slice().sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
  const assetsTotal = r2(sum(assets));
  const liabTotal = r2(sum(liabilities));
  const netNow = r2(assetsTotal - liabTotal);
  return NextResponse.json({
    ok: true, assets, liabilities, date: v.date || todayStr(), snapshots,
    assetsTotal, liabTotal, netNow, persisted: persistenceEnabled(),
  });
}

export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    const body = await req.json();
    const cur = (await readJson("vermogen.json", SEED)) || SEED;

    // Opslaan + vastleggen op de door jou gekozen datum (maakt/overschrijft een meetpunt).
    if (body.action === "save") {
      const assets = body.assets ?? cur.assets ?? [];
      const liabilities = body.liabilities ?? cur.liabilities ?? [];
      const date = body.date || todayStr();
      const assetsTotal = r2(sum(assets));
      const liabTotal = r2(sum(liabilities));
      const net = r2(assetsTotal - liabTotal);
      const snaps = (cur.snapshots || []).filter((s: any) => s.date !== date);
      snaps.push({ date, net, assetsTotal, liabTotal });
      snaps.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
      await writeJson("vermogen.json", { ...cur, assets, liabilities, date, snapshots: snaps });
      return NextResponse.json({ ok: true, snapshots: snaps, net, assetsTotal, liabTotal });
    }

    // Verwijder een meetpunt
    if (body.action === "deleteSnapshot") {
      const snaps = (cur.snapshots || []).filter((s: any) => s.date !== body.date);
      await writeJson("vermogen.json", { ...cur, snapshots: snaps });
      return NextResponse.json({ ok: true, snapshots: snaps });
    }

    // Lichte autosave van velden (zonder meetpunt), zodat je niets kwijtraakt tijdens het typen
    const next = {
      ...cur,
      assets: body.assets ?? cur.assets,
      liabilities: body.liabilities ?? cur.liabilities,
      date: body.date ?? cur.date,
    };
    await writeJson("vermogen.json", next);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
