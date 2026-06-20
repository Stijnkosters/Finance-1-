import { NextResponse } from "next/server";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

// Handmatige vermogenssheet (zakelijk + privé). Jij vult zelf in, kiest de datum, drukt zelf op opslaan.
// CSV-imports raken dit NIET — die zijn alleen voor Overzicht / Netto P&L.
const SEED = {
  assets: [
    { name: "Rabobank zakelijk", amount: 0 },
    { name: "Wise", amount: 0 },
    { name: "Revolut", amount: 0 },
    { name: "PayPal", amount: 0 },
    { name: "Shopify uit te betalen", amount: 0 },
    { name: "NicheBay saldo", amount: 0 },
    { name: "Voorraad", amount: 0 },
  ],
  liabilities: [
    { name: "American Express", amount: 0 },
    { name: "Rabo creditcard", amount: 0 },
    { name: "BTW-reservering", amount: 0 },
    { name: "Openstaande facturen", amount: 0 },
  ],
  assetsPrive: [
    { name: "Privé betaalrekening", amount: 0 },
    { name: "Spaarrekening", amount: 0 },
    { name: "Beleggingen", amount: 0 },
    { name: "Crypto", amount: 0 },
    { name: "Contant", amount: 0 },
  ],
  liabPrive: [
    { name: "Privé creditcard", amount: 0 },
    { name: "Leningen", amount: 0 },
  ],
  date: "",
  snapshots: [] as any[],
};

const sum = (rows: any[]) => (rows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const todayStr = () => new Date().toISOString().slice(0, 10);

function totals(v: any) {
  const aZ = r2(sum(v.assets)), lZ = r2(sum(v.liabilities));
  const aP = r2(sum(v.assetsPrive)), lP = r2(sum(v.liabPrive));
  const netZ = r2(aZ - lZ), netP = r2(aP - lP), netT = r2(netZ + netP);
  return { aZ, lZ, aP, lP, netZ, netP, netT };
}

export async function GET() {
  const v = (await readJson("vermogen.json", null)) || SEED;
  // backwards-compat: zorg dat privé-arrays bestaan
  const data = {
    assets: v.assets || [], liabilities: v.liabilities || [],
    assetsPrive: v.assetsPrive || [], liabPrive: v.liabPrive || [],
    date: v.date || todayStr(), snapshots: (v.snapshots || []).slice().sort((a: any, b: any) => String(a.date).localeCompare(String(b.date))),
  };
  const t = totals(data);
  return NextResponse.json({ ok: true, ...data, totals: t, persisted: persistenceEnabled() });
}

export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    const body = await req.json();
    const cur = (await readJson("vermogen.json", SEED)) || SEED;

    if (body.action === "save") {
      const merged = {
        ...cur,
        assets: body.assets ?? cur.assets ?? [],
        liabilities: body.liabilities ?? cur.liabilities ?? [],
        assetsPrive: body.assetsPrive ?? cur.assetsPrive ?? [],
        liabPrive: body.liabPrive ?? cur.liabPrive ?? [],
        date: body.date || todayStr(),
      };
      const t = totals(merged);
      const snap = { date: merged.date, net: t.netZ, netPrive: t.netP, netTotal: t.netT, assetsTotal: t.aZ, liabTotal: t.lZ, assetsPriveTotal: t.aP, liabPriveTotal: t.lP };
      const snaps = (cur.snapshots || []).filter((s: any) => s.date !== merged.date);
      snaps.push(snap);
      snaps.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
      await writeJson("vermogen.json", { ...merged, snapshots: snaps });
      return NextResponse.json({ ok: true, snapshots: snaps, totals: t });
    }

    if (body.action === "deleteSnapshot") {
      const snaps = (cur.snapshots || []).filter((s: any) => s.date !== body.date);
      await writeJson("vermogen.json", { ...cur, snapshots: snaps });
      return NextResponse.json({ ok: true, snapshots: snaps });
    }

    // lichte autosave (zonder meetpunt)
    const next = {
      ...cur,
      assets: body.assets ?? cur.assets,
      liabilities: body.liabilities ?? cur.liabilities,
      assetsPrive: body.assetsPrive ?? cur.assetsPrive,
      liabPrive: body.liabPrive ?? cur.liabPrive,
      date: body.date ?? cur.date,
    };
    await writeJson("vermogen.json", next);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
