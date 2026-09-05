import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify";
import { getShop } from "@/lib/shops";
import { resolveShopifyCfg, shopHasCredentials } from "@/lib/shopifyAuth";
import { computePL } from "@/lib/pl";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";
import costsDrivemax from "@/data/costs.json";
import costsHomivo from "@/data/costs-homivo.json";

// ============================================================
// PRIJSWIJZIGING — EFFECT METEN (vóór vs ná)
// De app houdt prijzen AUTOMATISCH bij: bij elke keer dat deze tab laadt, leest 'ie de huidige Shopify-prijzen
// en vergelijkt ze met de vorige keer. Verandert een prijs, dan legt 'ie dat zelf vast (datum = moment van
// detecteren). Je hoeft dus niets handmatig te doen — al kun je een datum corrigeren of handmatig toevoegen.
// Daarna vergelijkt deze route een periode VÓÓR met een even lange periode NÁ de wijziging:
//   • per product: verkochte stuks, omzet, COGS en productwinst (omzet − COGS − ~1,8% betaalkosten;
//     EXCLUSIEF ads, want ad-spend wordt niet per product bijgehouden).
//   • store-breed (zelfde vensters): totale winst (incl. ads) + ROAS — zo zie je het advertentie-effect.
// Vensters zijn even lang: is er sinds de wijziging nog geen 14/30/60 dagen verstreken, dan vergelijken we
// over het aantal dagen dat er WEL verstreken is (eerlijke vergelijking).
// ============================================================

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FEE_RATE = 0.018; // betaalkosten ~1,8% (zelfde als lib/pl.ts / productMargins)

const COSTS_BY_KEY: Record<string, Record<string, { title: string; price: number; cost: number }>> = {
  drivemax: (costsDrivemax as any).costs || {},
  homivo: (costsHomivo as any).costs || {},
};

const LOG_FILE = (shop: string) => `price-changes-${shop}.json`;
const SNAP_FILE = (shop: string) => `price-snapshot-${shop}.json`;

// Alle huidige variant-prijzen uit Shopify (voor automatische detectie van prijswijzigingen).
const VARIANTS_Q = `
query Variants($cursor: String) {
  productVariants(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id price displayName product { title } }
  }
}`;

const ORDERS_Q = `
query Orders($cursor: String, $q: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      lineItems(first: 50) {
        nodes {
          quantity
          variant { id }
          discountedTotalSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function addDays(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
function daysBetween(fromIso: string, toIso: string) {
  const a = new Date(fromIso + "T00:00:00Z").getTime(), b = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000) + 1;
}

// Verkochte stuks + omzet voor ÉÉN variant in een datumbereik (uit de Shopify-orderregels).
async function productWindow(shopifyCfg: any, variantId: string, from: string, to: string) {
  const q = `created_at:>='${from}T00:00:00Z' created_at:<='${to}T23:59:59Z'`;
  let cursor: string | null = null;
  let units = 0, revenue = 0;
  for (let i = 0; i < 60; i++) {
    const data = await shopifyGraphQL(ORDERS_Q, { cursor, q }, shopifyCfg);
    const conn = data.orders;
    for (const o of conn.nodes) {
      for (const li of o.lineItems?.nodes || []) {
        if ((li.variant?.id || "") !== variantId) continue;
        units += li.quantity || 0;
        revenue += parseFloat(li.discountedTotalSet?.shopMoney?.amount || "0") || 0;
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return { units, revenue: Math.round(revenue * 100) / 100 };
}

// AUTOMATISCHE DETECTIE: lees huidige Shopify-prijzen, vergelijk met de vorige snapshot, en leg elke
// gewijzigde prijs zelf vast. Eerste keer = alleen een baseline opslaan (geen "wijzigingen" verzinnen).
// Retourneert het (mogelijk aangevulde) wijzigingen-logboek + wanneer er voor het laatst gecheckt is.
async function syncPrices(shopParam: string, shopifyCfg: any) {
  const changes: any[] = await readJson(LOG_FILE(shopParam), []);
  // Zonder opslag (DATA_DIR) kunnen we niets onthouden → sla detectie stil over.
  if (!persistenceEnabled()) return { changes, lastCheck: null as string | null, detected: 0, baseline: false, stored: false };

  // Huidige prijzen ophalen.
  const current: Record<string, { price: number; title: string }> = {};
  let cursor: string | null = null;
  for (let i = 0; i < 40; i++) {
    const data = await shopifyGraphQL(VARIANTS_Q, { cursor }, shopifyCfg);
    const conn = data.productVariants;
    for (const v of conn.nodes) {
      const price = parseFloat(v.price || "0") || 0;
      const title = v.product?.title || v.displayName || v.id;
      current[v.id] = { price, title };
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  const snap: any = await readJson(SNAP_FILE(shopParam), null);
  const now = new Date();
  const today = ymd(now);

  // Eerste run: alleen baseline vastleggen.
  if (!snap || !snap.prices) {
    await writeJson(SNAP_FILE(shopParam), { updatedAt: now.toISOString(), prices: current });
    return { changes, lastCheck: now.toISOString(), detected: 0, baseline: true, stored: true };
  }

  // Diff: prijs anders dan vorige snapshot → automatisch vastleggen.
  const detected: any[] = [];
  for (const [vid, cur] of Object.entries(current)) {
    const prev = snap.prices[vid];
    if (!prev) continue; // nieuw product → alleen in baseline opnemen, niet als "wijziging"
    if (Math.abs((prev.price || 0) - cur.price) >= 0.005) {
      detected.push({
        id: `auto-${Date.now().toString(36)}-${vid.split("/").pop()}`,
        variantId: vid,
        title: cur.title,
        oldPrice: Math.round((prev.price || 0) * 100) / 100,
        newPrice: Math.round(cur.price * 100) / 100,
        date: today,
        auto: true,
        createdAt: now.toISOString(),
      });
    }
  }

  let nextChanges = changes;
  if (detected.length) nextChanges = [...detected, ...changes];
  // Snapshot bijwerken naar de nieuwe prijzen (ook als er niets veranderde: updatedAt verversen).
  await writeJson(SNAP_FILE(shopParam), { updatedAt: now.toISOString(), prices: current });
  if (detected.length) await writeJson(LOG_FILE(shopParam), nextChanges);

  return { changes: nextChanges, lastCheck: now.toISOString(), detected: detected.length, baseline: false, stored: true };
}

// GET: lijst met vastgelegde wijzigingen + producten voor de kiezer. Met variantId+date+window → de analyse.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shopParam = searchParams.get("shop") || "drivemax";
    const costs = COSTS_BY_KEY[getShop(shopParam).costsKey] || {};

    const variantId = searchParams.get("variantId");
    const date = searchParams.get("date");
    const window = Math.min(Math.max(parseInt(searchParams.get("window") || "30", 10) || 30, 1), 180);

    // Zonder analyse-params: eerst automatisch nieuwe Shopify-prijzen detecteren, dan lijst + producten teruggeven.
    if (!variantId || !date) {
      const shopCfg = getShop(shopParam);
      let changes: any[] = await readJson(LOG_FILE(shopParam), []);
      let lastCheck: string | null = null;
      let autoBaseline = false;
      if (await shopHasCredentials(shopCfg)) {
        try {
          const shopifyCfg = await resolveShopifyCfg(shopCfg);
          const sync = await syncPrices(shopParam, shopifyCfg);
          changes = sync.changes; lastCheck = sync.lastCheck; autoBaseline = sync.baseline;
        } catch { /* detectie faalt niet-blokkerend; toon in elk geval de bestaande lijst */ }
      }
      const products = Object.entries(costs)
        .map(([id, c]) => ({ variantId: id, title: c.title, price: c.price, cost: c.cost }))
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      return NextResponse.json({ ok: true, shop: shopParam, changes, products, lastCheck, autoBaseline, autoEnabled: persistenceEnabled() });
    }

    // ── ANALYSE: vóór vs ná ──────────────────────────────────────────────
    const shop = getShop(shopParam);
    if (!(await shopHasCredentials(shop))) {
      return NextResponse.json({ ok: false, error: `Shop "${shopParam}" niet geconfigureerd.` }, { status: 400 });
    }
    const shopifyCfg = await resolveShopifyCfg(shop);
    const unitCost = costs[variantId]?.cost || 0;

    const today = ymd(new Date());
    // NÁ-venster: vanaf de wijzigingsdatum tot en met (datum + window − 1), maar nooit voorbij vandaag.
    const afterFrom = date;
    let afterTo = addDays(date, window - 1);
    if (afterTo > today) afterTo = today;
    const afterDays = Math.max(0, daysBetween(afterFrom, afterTo));
    // VÓÓR-venster: even veel dagen, eindigend de dag vóór de wijziging.
    const beforeTo = addDays(date, -1);
    const beforeFrom = addDays(beforeTo, -(Math.max(afterDays, 1) - 1));

    const [pBefore, pAfter, sBefore, sAfter] = await Promise.all([
      productWindow(shopifyCfg, variantId, beforeFrom, beforeTo),
      afterDays > 0 ? productWindow(shopifyCfg, variantId, afterFrom, afterTo) : Promise.resolve({ units: 0, revenue: 0 }),
      computePL(shopParam, beforeFrom, beforeTo),
      afterDays > 0 ? computePL(shopParam, afterFrom, afterTo) : Promise.resolve(null as any),
    ]);

    const prodRow = (w: { units: number; revenue: number }) => {
      const cogs = Math.round(unitCost * w.units * 100) / 100;
      const fees = Math.round(w.revenue * FEE_RATE * 100) / 100;
      const winst = Math.round((w.revenue - cogs - fees) * 100) / 100;
      return { units: w.units, revenue: w.revenue, cogs, fees, winst };
    };
    const storeRow = (pl: any) => pl ? { totalProfit: pl.totals?.totalProfit ?? 0, roas: pl.totals?.roas ?? 0, omzet: pl.totals?.omzet ?? 0, adspend: pl.totals?.adspend ?? 0 } : { totalProfit: 0, roas: 0, omzet: 0, adspend: 0 };

    return NextResponse.json({
      ok: true, shop: shopParam,
      variantId, title: costs[variantId]?.title || variantId, unitCost,
      window, afterDays, volledig: afterDays >= window,
      windows: { before: { from: beforeFrom, to: beforeTo }, after: { from: afterFrom, to: afterTo } },
      product: { before: prodRow(pBefore), after: prodRow(pAfter) },
      store: { before: storeRow(sBefore), after: storeRow(sAfter) },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST: een wijziging vastleggen of verwijderen.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const shopParam = body.shop || "drivemax";
    const action = body.action || "add";
    const changes: any[] = await readJson(LOG_FILE(shopParam), []);

    if (action === "delete") {
      const next = changes.filter((c) => String(c.id) !== String(body.id));
      await writeJson(LOG_FILE(shopParam), next);
      return NextResponse.json({ ok: true, changes: next });
    }

    if (action === "editDate") {
      const date = String(body.date || "").trim();
      if (!date) return NextResponse.json({ ok: false, error: "Geen datum opgegeven." }, { status: 400 });
      const next = changes.map((c) => (String(c.id) === String(body.id) ? { ...c, date } : c));
      await writeJson(LOG_FILE(shopParam), next);
      return NextResponse.json({ ok: true, changes: next });
    }

    // add
    const variantId = String(body.variantId || "").trim();
    const date = String(body.date || "").trim();
    if (!variantId || !date) return NextResponse.json({ ok: false, error: "Kies een product en een datum." }, { status: 400 });
    const costs = COSTS_BY_KEY[getShop(shopParam).costsKey] || {};
    const entry = {
      id: Date.now().toString(36),
      variantId,
      title: costs[variantId]?.title || body.title || variantId,
      oldPrice: Number(body.oldPrice) || 0,
      newPrice: Number(body.newPrice) || 0,
      date,
      createdAt: new Date().toISOString(),
    };
    const next = [entry, ...changes];
    await writeJson(LOG_FILE(shopParam), next);
    return NextResponse.json({ ok: true, changes: next, entry });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
