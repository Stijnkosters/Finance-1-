import { NextResponse } from "next/server";
import { paypalConfigured, paypalBalance, paypalTransactions } from "@/lib/paypal";
import { ingestTransactions, captureBalance } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!paypalConfigured()) {
    return NextResponse.json({ ok: false, error: "PAYPAL_CLIENT_ID / PAYPAL_SECRET ontbreken. Maak een Live REST-app aan op developer.paypal.com." }, { status: 400 });
  }
  try {
    const days = Number(new URL(req.url).searchParams.get("days") || 31);
    let eur = 0;
    try { eur = (await paypalBalance()).eur; await captureBalance("paypal", eur, new Date().toISOString().slice(0, 10)); } catch (e: any) { /* saldo optioneel */ }
    const txs = await paypalTransactions(days);
    const result = await ingestTransactions("paypal", txs);
    return NextResponse.json({ ok: true, balance: eur, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
