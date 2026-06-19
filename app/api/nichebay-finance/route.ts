import { NextResponse } from "next/server";
import { nichebayConfigured, nbProbeBalance } from "@/lib/nichebay";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET = probe: vindt je NicheBay-saldo en legt het (indien gevonden) vast als bezitting.
export async function GET() {
  if (!nichebayConfigured()) {
    return NextResponse.json({ ok: false, error: "NICHEBAY_API_KEY ontbreekt." }, { status: 400 });
  }
  try {
    const probe = await nbProbeBalance();
    let captured: any = null;
    if (probe.found && persistenceEnabled()) {
      const balances = await readJson("balances.json", {});
      const today = new Date().toISOString().slice(0, 10);
      balances["NicheBay saldo"] = { amount: probe.found.value, date: today, type: "bank" };
      await writeJson("balances.json", balances);
      captured = { name: "NicheBay saldo", amount: probe.found.value, date: today, via: `${probe.found.path} · ${probe.found.field}` };
    }
    return NextResponse.json({ ok: true, found: probe.found, captured, results: probe.results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
