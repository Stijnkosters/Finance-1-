import { NextResponse } from "next/server";
import { wiseConfigured, wiseBalances } from "@/lib/wise";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET = haalt je Wise EUR-saldo op en legt het vast als bezitting "Wise".
export async function GET() {
  if (!wiseConfigured()) {
    return NextResponse.json({ ok: false, error: "WISE_API_TOKEN ontbreekt. Maak een read-only token aan in Wise → Settings → API tokens en zet 'm als env-var WISE_API_TOKEN." }, { status: 400 });
  }
  try {
    const b = await wiseBalances();
    let captured: any = null;
    if (persistenceEnabled()) {
      const balances = await readJson("balances.json", {});
      const today = new Date().toISOString().slice(0, 10);
      balances["Wise"] = { amount: b.eur, date: today, type: "bank" };
      await writeJson("balances.json", balances);
      captured = { name: "Wise", amount: b.eur, date: today };
    }
    return NextResponse.json({ ok: true, eur: b.eur, currencies: b.list, captured });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
