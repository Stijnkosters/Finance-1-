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

function capKey(name: string, captured: any) {
  if (!name) return null;
  return Object.keys(captured || {}).find((k) => name.toLowerCase().includes(k.toLowerCase())) || null;
}
// Saldo's uit de CSV-imports automatisch in de bezittingen verwerken
function mergeAssets(assets: any[], captured: any) {
  const used = new Set<string>();
  const merged = (assets || []).map((a) => {
    const k = capKey(a.name, captured);
    if (k) { used.add(k); return { ...a, amount: captured[k].amount, capturedDate: captured[k].date }; }
    return a;
  });
  for (const k of Object.keys(captured || {})) {
    if (!used.has(k) && !merged.some((a) => a.name && a.name.toLowerCase().includes(k.toLowerCase()))) {
      merged.push({ name: k, amount: captured[k].amount, capturedDate: captured[k].date });
    }
  }
  return merged;
}

export async function GET() {
  const v = await readJson("vermogen.json", null) || SEED;
  const captured = await readJson("balances.json", {});
  const hist = await readJson("balances-history.json", {});
  const assets = mergeAssets(v.assets, captured);
  const liabTotal = sum(v.liabilities || []);

  // rekeningen mét maandhistorie (uit CSV) vs zonder (handmatig, vlak doorgetrokken)
  const histSources = Object.keys(hist);
  const flatAssets = assets.filter((a: any) => !histSources.some((s) => a.name && (a.name.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(a.name.toLowerCase()))));
  const flatTotal = sum(flatAssets);

  const monthsSet = new Set<string>();
  for (const s of histSources) for (const m of Object.keys(hist[s])) monthsSet.add(m);
  const cf = await readJson("cashflow-history.json", {});
  for (const s of Object.keys(cf)) for (const m of Object.keys(cf[s])) monthsSet.add(m);
  const months = [...monthsSet].sort();
  const curve = months.map((m) => {
    let total = flatTotal;
    for (const s of histSources) {
      const ms = Object.keys(hist[s]).filter((x) => x <= m).sort();
      if (ms.length) total += Number(hist[s][ms[ms.length - 1]]) || 0;
    }
    let inn = 0, out = 0;
    for (const s of Object.keys(cf)) {
      const f = cf[s][m];
      if (f) { inn += Number(f.in) || 0; out += Number(f.out) || 0; }
    }
    return { month: m, net: Math.round((total - liabTotal) * 100) / 100, in: Math.round(inn * 100) / 100, out: Math.round(out * 100) / 100 };
  });

  return NextResponse.json({ ok: true, assets, liabilities: v.liabilities, snapshots: v.snapshots || [], captured, monthlyNetWorth: curve, hasHistory: histSources.length > 0, persisted: persistenceEnabled() });
}

export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    const body = await req.json();
    const cur = await readJson("vermogen.json", SEED);

    if (body.action === "snapshot") {
      const month = body.month || new Date().toISOString().slice(0, 7);
      const captured = await readJson("balances.json", {});
      const assets = mergeAssets(cur.assets || [], captured);
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
