import { NextResponse } from "next/server";
import { parseBankCsv, dedupKey, SOURCES } from "@/lib/bankparse";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";
import { decorate } from "@/lib/meta";

export const dynamic = "force-dynamic";

async function decoratedPending() {
  const pending = await readJson("pending-import.json", []);
  const meta = await readJson("expense-meta.json", {});
  const rules = await readJson("expense-rules.json", []);
  return decorate(pending, meta, rules).filter((e: any) => !e.deleted);
}

async function recentIncome() {
  const inc: any[] = await readJson("income.json", []);
  return inc
    .map((e) => ({ ...e, id: dedupKey(e) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 400);
}

// Huidige wachtrij ophalen (zodat hij blijft staan na herladen)
export async function GET() {
  if (!persistenceEnabled()) return NextResponse.json({ ok: true, pending: [], income: [] });
  return NextResponse.json({ ok: true, pending: await decoratedPending(), income: await recentIncome() });
}

// Importeren -> in de wachtrij zetten (nog NIET meegeteld)
export async function POST(req: Request) {
  try {
    const source = new URL(req.url).searchParams.get("source") || "rabobank";
    const body = await req.text();
    if (!body || body.length < 10) {
      return NextResponse.json({ ok: false, error: "Leeg of ongeldig bestand." }, { status: 400 });
    }
    const { expenses, stats, source: sourceName, endBalance, monthlyBalances, monthlyFlow, incomeRows, excludedRows } = parseBankCsv(body, source);

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

    // saldo uit de CSV bewaren (per bron) voor het Vermogen-overzicht
    if (persistenceEnabled() && endBalance) {
      const balances = await readJson("balances.json", {});
      const prev = balances[sourceName];
      const stype = SOURCES[source]?.type || "bank";
      if (!prev || endBalance.date >= prev.date) {
        balances[sourceName] = { amount: endBalance.amount, date: endBalance.date, type: stype };
        await writeJson("balances.json", balances);
      }
    }
    // maand-eindsaldo's bewaren (voor de vermogenscurve vanaf het begin)
    if (persistenceEnabled() && monthlyBalances && Object.keys(monthlyBalances).length) {
      const hist = await readJson("balances-history.json", {});
      hist[sourceName] = { ...(hist[sourceName] || {}), ...monthlyBalances };
      await writeJson("balances-history.json", hist);
    }
    // geldstroom (in/uit) per maand bewaren
    if (persistenceEnabled() && monthlyFlow && Object.keys(monthlyFlow).length) {
      const cf = await readJson("cashflow-history.json", {});
      cf[sourceName] = { ...(cf[sourceName] || {}), ...monthlyFlow };
      await writeJson("cashflow-history.json", cf);
    }
    // inkomende betalingen bewaren (dedup) — alleen ter info / cashflow, telt niet in P&L
    let incomeStaged = 0;
    if (persistenceEnabled() && incomeRows && incomeRows.length) {
      const inc: any[] = await readJson("income.json", []);
      const seenI = new Set(inc.map(dedupKey));
      const addI = incomeRows.filter((e: any) => {
        const k = dedupKey(e);
        if (seenI.has(k)) return false;
        seenI.add(k);
        return true;
      });
      if (addI.length) await writeJson("income.json", [...inc, ...addI]);
      incomeStaged = addI.length;
    }

    return NextResponse.json({
      ok: true,
      source: sourceName,
      parsed: expenses.length,
      staged,
      duplicates,
      incomeStaged,
      excluded: (excludedRows || []).map((e: any) => ({ ...e, id: dedupKey(e) })),
      persisted: persistenceEnabled(),
      stats,
      pending: persistenceEnabled() ? await decoratedPending() : [],
      income: persistenceEnabled() ? await recentIncome() : [],
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
    else if (what === "income") await writeJson("income.json", []);
    else await writeJson("imported-expenses.json", []);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
