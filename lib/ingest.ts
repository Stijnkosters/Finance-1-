import { readJson, writeJson, persistenceEnabled } from "./store";
import { classifyTx, dedupKey, SOURCES } from "./bankparse";

export type RawTx = { date: string; desc: string; amount: number; category?: string };

// Verwerkt API-transacties (GoCardless/PayPal) via dezelfde regels + dedup als de CSV-import.
export async function ingestTransactions(sourceKey: string, txs: RawTx[]) {
  const src = SOURCES[sourceKey] || SOURCES.anders;
  const exp: any[] = [];
  const inc: any[] = [];
  const flow: Record<string, { in: number; out: number }> = {};
  let excluded = 0, skipped = 0;

  for (const t of txs) {
    if (!t.date || !t.amount) { skipped++; continue; }
    const mk = t.date.slice(0, 7);
    if (src.type !== "creditcard") {
      if (!flow[mk]) flow[mk] = { in: 0, out: 0 };
      if (t.amount > 0) flow[mk].in += t.amount; else flow[mk].out += -t.amount;
    }
    // vaste categorie (bijv. PayPal-refund) overschrijft de automatische classificatie
    if (t.category) {
      exp.push({ date: t.date, omschrijving: (t.desc || "(geen omschrijving)").slice(0, 120), methode: src.label, bedrag: Math.abs(t.amount), category: t.category });
      continue;
    }
    const c = classifyTx(sourceKey, t.desc, t.amount);
    if (c.kind === "excluded") { excluded++; continue; }
    if (c.kind === "skip") { skipped++; continue; }
    const row = { date: t.date, omschrijving: (t.desc || "(geen omschrijving)").slice(0, 120), methode: src.label, bedrag: c.bedrag, category: c.category };
    if (c.kind === "income") inc.push(row); else exp.push(row);
  }

  let staged = 0, duplicates = 0, incomeAdded = 0;
  if (persistenceEnabled()) {
    const pending = await readJson("pending-import.json", []);
    const imported = await readJson("imported-expenses.json", []);
    const seen = new Set([...(pending || []), ...(imported || [])].map(dedupKey));
    const add = exp.filter((e) => { const k = dedupKey(e); if (seen.has(k)) return false; seen.add(k); return true; });
    if (add.length) await writeJson("pending-import.json", [...(pending || []), ...add]);
    staged = add.length;
    duplicates = exp.length - add.length;

    const income = await readJson("income.json", []);
    const seenI = new Set((income || []).map(dedupKey));
    const addI = inc.filter((e) => { const k = dedupKey(e); if (seenI.has(k)) return false; seenI.add(k); return true; });
    if (addI.length) await writeJson("income.json", [...(income || []), ...addI]);
    incomeAdded = addI.length;

    if (Object.keys(flow).length) {
      const cf = await readJson("cashflow-history.json", {});
      cf[src.name] = { ...(cf[src.name] || {}), ...flow };
      await writeJson("cashflow-history.json", cf);
    }
  }

  return { total: txs.length, staged, duplicates, income: incomeAdded, excluded, skipped };
}

// Saldo vastleggen voor het Vermogen-overzicht (type bepaalt bezitting vs schuld)
export async function captureBalance(sourceKey: string, amount: number, date: string) {
  if (!persistenceEnabled()) return;
  const src = SOURCES[sourceKey] || SOURCES.anders;
  const balances = await readJson("balances.json", {});
  balances[src.name] = { amount, date: date || new Date().toISOString().slice(0, 10), type: src.type === "creditcard" ? "creditcard" : "bank" };
  await writeJson("balances.json", balances);
}
