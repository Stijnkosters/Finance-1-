import { NextResponse } from "next/server";
import { gcConfigured, gcRequisition, gcAccountData, gcToken } from "@/lib/gocardless";
import { ingestTransactions, captureBalance } from "@/lib/ingest";
import { readJson } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!gcConfigured()) return NextResponse.json({ ok: false, error: "GoCardless niet geconfigureerd." }, { status: 400 });
  try {
    const reqs = await readJson("requisitions.json", []);
    if (!reqs.length) return NextResponse.json({ ok: true, results: [], note: "Nog geen banken gekoppeld." });

    const tk = await gcToken();
    const results: any[] = [];

    for (const r of reqs) {
      try {
        const req = await gcRequisition(r.id, tk);
        if (req.status !== "LN" && !(req.accounts || []).length) {
          results.push({ name: r.name, status: req.status, note: "Nog niet (volledig) geautoriseerd — open opnieuw de koppel-link." });
          continue;
        }
        let staged = 0, dup = 0, inc = 0, excl = 0, bal: number | null = null;
        for (const accId of req.accounts || []) {
          const data = await gcAccountData(accId, tk);
          if (data.balance && data.balance.currency === "EUR") {
            await captureBalance(r.sourceKey, data.balance.amount, new Date().toISOString().slice(0, 10));
            bal = data.balance.amount;
          }
          const res = await ingestTransactions(r.sourceKey, data.transactions);
          staged += res.staged; dup += res.duplicates; inc += res.income; excl += res.excluded;
        }
        results.push({ name: r.name, status: "OK", balance: bal, staged, duplicates: dup, income: inc, excluded: excl });
      } catch (e: any) {
        results.push({ name: r.name, status: "FOUT", error: e.message });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
