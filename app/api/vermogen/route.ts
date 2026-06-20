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

// captured-saldo's splitsen: creditcards = schuld, rest = bezitting
function splitCaptured(captured: any) {
  const assets: any = {}, liabs: any = {};
  for (const k of Object.keys(captured || {})) {
    const c = captured[k];
    if (c && c.type === "creditcard") liabs[k] = { amount: Math.abs(Number(c.amount) || 0), date: c.date };
    else assets[k] = { amount: Number(c.amount) || 0, date: c.date };
  }
  return { assets, liabs };
}

// CSV-saldo's automatisch in de juiste regels verwerken (bezitting óf schuld)
function mergeCaptured(rows: any[], captured: any) {
  const used = new Set<string>();
  const merged = (rows || []).map((a) => {
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

export async function GET(req: Request) {
  const v = await readJson("vermogen.json", null) || SEED;
  const captured = await readJson("balances.json", {});
  const hist = await readJson("balances-history.json", {});
  const { assets: capA, liabs: capL } = splitCaptured(captured);
  const assets = mergeCaptured(v.assets, capA);
  const liabilities = mergeCaptured(v.liabilities, capL);
  const assetsTotal = Math.round(sum(assets) * 100) / 100;
  const liabTotal = Math.round(sum(liabilities) * 100) / 100;
  const netNow = Math.round((assetsTotal - liabTotal) * 100) / 100;

  const cf = await readJson("cashflow-history.json", {});
  const histSources = Object.keys(hist);
  const cfSources = Object.keys(cf);

  const monthsSet = new Set<string>();
  for (const s of histSources) for (const m of Object.keys(hist[s])) monthsSet.add(m);
  for (const s of cfSources) for (const m of Object.keys(cf[s])) monthsSet.add(m);
  const months = [...monthsSet].sort();

  const matchKey = (name: string, keys: string[]) =>
    keys.find((s) => name && (name.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(name.toLowerCase()))) || null;
  const netFlow = (s: string, m: string) => { const f = cf[s]?.[m]; return f ? (Number(f.in) || 0) - (Number(f.out) || 0) : 0; };

  // Per bezitting bepalen hoe de maandwaarde tot stand komt:
  //  1) CSV-saldohistorie (exact)  2) terugrekenen uit ankersaldo + stromen  3) vlak
  type Plan = { kind: "hist"; key: string } | { kind: "recon"; key: string; anchorMonth: string; anchorAmount: number } | { kind: "flat"; amount: number };
  const plans: Plan[] = assets.map((a: any) => {
    const hk = matchKey(a.name, histSources);
    if (hk) return { kind: "hist", key: hk };
    const ck = matchKey(a.name, cfSources);
    if (ck && a.date && a.amount != null && a.amount !== "") {
      return { kind: "recon", key: ck, anchorMonth: String(a.date).slice(0, 7), anchorAmount: Number(a.amount) || 0 };
    }
    return { kind: "flat", amount: Number(a.amount) || 0 };
  });

  const assetAt = (p: Plan, m: string): number => {
    if (p.kind === "flat") return p.amount;
    if (p.kind === "hist") {
      const ms = Object.keys(hist[p.key]).filter((x) => x <= m).sort();
      return ms.length ? Number(hist[p.key][ms[ms.length - 1]]) || 0 : 0;
    }
    // recon: balance_end(m) = anker ± som van nettostromen tussen m en ankermaand
    if (m <= p.anchorMonth) {
      let s = 0;
      for (const k of months) if (k > m && k <= p.anchorMonth) s += netFlow(p.key, k);
      return p.anchorAmount - s;
    } else {
      let s = 0;
      for (const k of months) if (k > p.anchorMonth && k <= m) s += netFlow(p.key, k);
      return p.anchorAmount + s;
    }
  };

  const curve = months.map((m) => {
    let total = 0;
    for (const p of plans) total += assetAt(p, m);
    let inn = 0, out = 0;
    for (const s of cfSources) { const f = cf[s][m]; if (f) { inn += Number(f.in) || 0; out += Number(f.out) || 0; } }
    return { month: m, net: Math.round((total - liabTotal) * 100) / 100, in: Math.round(inn * 100) / 100, out: Math.round(out * 100) / 100 };
  });

  // Peildatum-snapshot: elke rekening op het einde van een gekozen maand (alles gelijk).
  const lastDayOf = (ym: string) => {
    const [y, mm] = ym.split("-").map(Number);
    const d = new Date(y, mm, 0).getDate();
    return `${ym}-${String(d).padStart(2, "0")}`;
  };
  const nowMonth = new Date().toISOString().slice(0, 7);
  const asofMonths = (months.length ? months : [nowMonth]).map((m) => ({
    val: m, label: new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" }), date: lastDayOf(m),
  }));
  const reqAsof = new URL(req.url).searchParams.get("asof");
  const asof = reqAsof && asofMonths.some((x) => x.val === reqAsof) ? reqAsof : asofMonths[asofMonths.length - 1].val;
  const asofDate = lastDayOf(asof);

  const assetsAsof = assets.map((a: any, i: number) => ({
    name: a.name, amount: Math.round(assetAt(plans[i], asof) * 100) / 100, date: asofDate, auto: plans[i].kind !== "flat",
  }));
  // schulden hebben (nog) geen maandhistorie -> vlakke huidige stand op de peildatum
  const liabAsof = liabilities.map((l: any) => ({ name: l.name, amount: Number(l.amount) || 0, date: asofDate }));
  const assetsTotalAsof = Math.round(sum(assetsAsof) * 100) / 100;
  const liabTotalAsof = Math.round(sum(liabAsof) * 100) / 100;
  const netAsof = Math.round((assetsTotalAsof - liabTotalAsof) * 100) / 100;

  return NextResponse.json({
    ok: true, assets, liabilities, assetsTotal, liabTotal, netNow, snapshots: v.snapshots || [], captured, monthlyNetWorth: curve,
    hasHistory: histSources.length > 0 || cfSources.length > 0, persisted: persistenceEnabled(),
    asof, asofDate, asofMonths, assetsAsof, liabAsof, assetsTotalAsof, liabTotalAsof, netAsof,
  });
}

export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) return NextResponse.json({ ok: false, error: "Geen opslag actief (DATA_DIR ontbreekt)." }, { status: 400 });
    const body = await req.json();
    const cur = await readJson("vermogen.json", SEED);

    if (body.action === "snapshot") {
      const month = body.month || new Date().toISOString().slice(0, 7);
      const captured = await readJson("balances.json", {});
      const { assets: capA, liabs: capL } = splitCaptured(captured);
      const assets = mergeCaptured(cur.assets || [], capA);
      const liabilities = mergeCaptured(cur.liabilities || [], capL);
      const net = Math.round((sum(assets) - sum(liabilities)) * 100) / 100;
      const snaps = (cur.snapshots || []).filter((s: any) => s.month !== month);
      snaps.push({ month, date: new Date().toISOString().slice(0, 10), net, assetsTotal: Math.round(sum(assets) * 100) / 100, liabTotal: Math.round(sum(liabilities) * 100) / 100 });
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
