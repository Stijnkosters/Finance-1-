import { NextResponse } from "next/server";
// pdf-parse levert geen types mee; we importeren direct het lib-bestand zodat
// het geen test-PDF probeert in te laden bij het opstarten.
// @ts-ignore
import pdf from "pdf-parse/lib/pdf-parse.js";
import { parseWinWinInvoice } from "@/lib/winwin";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";
import { getShop } from "@/lib/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Store = {
  orders: Record<string, number>;
  invoices: {
    invoiceNo: string | null;
    invoiceDate: string | null;
    orderCount: number;
    total: number;
    uploadedAt: string;
  }[];
};

const fileFor = (shopId: string) => `ordercogs-${getShop(shopId).costsKey}.json`;
const emptyStore = (): Store => ({ orders: {}, invoices: [] });

// Huidige stand ophalen (aantal opgeslagen orders + factuurhistorie).
export async function GET(req: Request) {
  const shopId = new URL(req.url).searchParams.get("shop") || "homivo";
  const store: Store = await readJson(fileFor(shopId), emptyStore());
  const orderCount = Object.keys(store.orders || {}).length;
  const totalStored = Object.values(store.orders || {}).reduce((a, b) => a + (b || 0), 0);
  return NextResponse.json({
    ok: true,
    persisted: persistenceEnabled(),
    shop: shopId,
    orderCount,
    totalStored: Math.round(totalStored * 100) / 100,
    invoices: (store.invoices || []).slice(-30).reverse(),
  });
}

// PDF-factuur uploaden -> per-order COGS opslaan.
export async function POST(req: Request) {
  try {
    if (!persistenceEnabled()) {
      return NextResponse.json(
        { ok: false, error: "Geen opslag actief. Voeg een Railway Volume toe en zet DATA_DIR." },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const shopId = String(form.get("shop") || "homivo");
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "Geen bestand ontvangen." }, { status: 400 });
    }

    const buf = Buffer.from(await (file as File).arrayBuffer());
    let text = "";
    try {
      const parsed = await pdf(buf);
      text = parsed?.text || "";
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `PDF lezen mislukt: ${e.message}` }, { status: 400 });
    }

    const inv = parseWinWinInvoice(text);
    if (!inv.orderCount) {
      return NextResponse.json(
        {
          ok: false,
          error: "Geen orderregels herkend in deze PDF. Is dit een Win-Win 'INVOICE LIST'?",
          textLen: (text || "").length,
          sample: (text || "").slice(0, 1800),
        },
        { status: 400 },
      );
    }

    const store: Store = await readJson(fileFor(shopId), emptyStore());
    if (!store.orders) store.orders = {};
    if (!store.invoices) store.invoices = [];

    // Dubbele upload van dezelfde factuur? Melden, maar wel opnieuw mergen (idempotent).
    const already = inv.invoiceNo
      ? store.invoices.some((x) => x.invoiceNo === inv.invoiceNo)
      : false;

    let added = 0, updated = 0;
    for (const [orderId, cost] of Object.entries(inv.orders)) {
      if (store.orders[orderId] == null) added++;
      else if (store.orders[orderId] !== cost) updated++;
      store.orders[orderId] = cost;
    }

    const logEntry = {
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      orderCount: inv.orderCount,
      total: inv.total,
      uploadedAt: new Date().toISOString(),
    };
    // Zelfde factuur opnieuw? Bestaande regel bijwerken i.p.v. dubbel loggen.
    const existingIdx = inv.invoiceNo
      ? store.invoices.findIndex((x) => x.invoiceNo === inv.invoiceNo)
      : -1;
    if (existingIdx >= 0) store.invoices[existingIdx] = logEntry;
    else store.invoices.push(logEntry);
    // historie beknopt houden
    if (store.invoices.length > 200) store.invoices = store.invoices.slice(-200);

    await writeJson(fileFor(shopId), store);

    return NextResponse.json({
      ok: true,
      shop: shopId,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      orderCount: inv.orderCount,
      total: inv.total,
      added,
      updated,
      alreadyUploaded: already,
      totalStoredOrders: Object.keys(store.orders).length,
      // kleine preview zodat je kunt controleren dat het klopt
      preview: inv.lines.slice(0, 8).map((l) => ({
        order: l.raw, product: l.product, qty: l.qty, price: l.price,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// Alle opgeslagen order-COGS voor een shop wissen (opnieuw beginnen).
export async function DELETE(req: Request) {
  if (!persistenceEnabled()) {
    return NextResponse.json({ ok: false, error: "Geen opslag actief." }, { status: 400 });
  }
  const shopId = new URL(req.url).searchParams.get("shop") || "homivo";
  await writeJson(fileFor(shopId), emptyStore());
  return NextResponse.json({ ok: true, shop: shopId });
}
