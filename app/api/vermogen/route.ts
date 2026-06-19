import { NextResponse } from "next/server";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

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
  snapshots: [] as any[],
};

function sum(rows: any[]) { return (rows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0); }

export async function GET() {
  const v = await readJson("vermogen.json", null);
  const captured = await readJson("balances.json", {});
  return NextResponse.json({ ok: true, ...(v || SEED), captured, persisted: persistenceEnabled() });
}

export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    const body = await req.json();
    const cur = await readJson("vermogen.json", SEED);

    if (body.action === "snapshot") {
      const month = body.month || new Date().toISOString().slice(0, 7);
      const assets = cur.assets || [];
      const liabilities = cur.liabilities || [];
      const net = sum(assets) - sum(liabilities);
      const snaps = (cur.snapshots || []).filter((s: any) => s.month !== month);
      snaps.push({ month, date: new Date().toISOString().slice(0, 10), net, assetsTotal: sum(assets), liabTotal: sum(liabilities) });
      snaps.sort((a: any, b: any) => a.month.localeCompare(b.month));
      await writeJson("vermogen.json", { ...cur, snapshots: snaps });
      return NextResponse.json({ ok: true, snapshots: snaps });
    }

    const next = {
      ...cur,
      assets: body.assets ?? cur.assets,
      liabilities: body.liabilities ?? cur.liabilities,
    };
    await writeJson("vermogen.json", next);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
