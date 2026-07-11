// NicheBay Open API client. Haalt per order de kostprijs op en mapt op Shopify-ordernummer.
// Docs: https://app.nichebay.com/shop_admin/apiDocument.html

const BASE = "https://dashboard-admin.nichebay.com/api/open/v1";
const KEY = process.env.NICHEBAY_API_KEY;

export function nichebayConfigured() {
  return !!KEY;
}

async function nbGet(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`NicheBay ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (j && j.success === false) throw new Error(`NicheBay: ${j.message || "error"}`);
  return j;
}

export async function nbFinancesSample(limit = 20) {
  const j = await nbGet(`/finances?page=1&limit=${limit}`);
  const list = extractList(j);
  return { sample: list[0] || null, count: Array.isArray(list) ? list.length : 0, keys: list[0] ? Object.keys(list[0]) : [] };
}

export async function nbTest() {
  return nbGet("/test");
}

// Mogelijke veldnamen — NicheBay-doc toont de schema's niet, dus we proberen de gangbare.
const ORDER_NO_FIELDS = [
  "order_no", "order_number", "platform_order_no", "platform_order_number",
  "shopify_order_no", "shopify_order_number", "client_order_no", "out_order_no",
  "store_order_no", "source_order_no", "external_order_no", "reference_no",
  "platform_order", "third_order_no", "channel_order_no",
];
const COST_FIELDS = [
  "store_pay_fee", "pay_fee", "total_cost", "cost_total", "order_cost",
  "cost", "cost_price", "pay_amount", "paid_amount", "product_cost",
  "goods_cost", "settle_amount",
];

function pick(obj: any, keys: string[]) {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  return null;
}
function toNum(v: any) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}
function normNo(s: any) {
  return String(s || "").replace(/^#/, "").trim();
}

function extractList(payload: any): any[] {
  const d = payload?.data ?? payload;
  if (Array.isArray(d)) return d;
  return d?.list || d?.orders || d?.items || d?.rows || d?.records || d?.data || [];
}

// Bouwt { '11547': kostprijs } over meerdere pagina's. Geeft ook een ruw sample-order terug
// zodat we de echte veldnamen kunnen verifiëren.
export async function fetchNicheBayCostByOrder(maxPages = 20, limit = 100) {
  const map: Record<string, number> = {};
  let sample: any = null;
  for (let page = 1; page <= maxPages; page++) {
    const j = await nbGet(`/orders?page=${page}&limit=${limit}`);
    const list = extractList(j);
    if (!Array.isArray(list) || list.length === 0) break;
    if (!sample) sample = list[0];
    for (const o of list) {
      const cost = toNum(pick(o, COST_FIELDS));
      const keys = new Set(
        [o.order_number, o.order_sn, pick(o, ORDER_NO_FIELDS)].map(normNo).filter(Boolean)
      );
      for (const k of keys) map[k] = cost;
    }
    if (list.length < limit) break;
  }
  return { map, sample };
}

// Probeert de gangbare endpoints om je wallet/accountsaldo te vinden.
const BALANCE_PATHS = ["/finances", "/finance", "/account", "/account/info", "/wallet", "/balance", "/user", "/user/info", "/userinfo", "/shop", "/shop/info", "/me"];
const BALANCE_FIELDS = ["balance", "available_balance", "wallet_balance", "account_balance", "saldo", "available", "amount", "remain", "remaining", "money", "wallet", "credit"];

function deepFindNumber(obj: any, fields: string[], depth = 0): { field: string; value: number } | null {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const k of Object.keys(obj)) {
    const lk = k.toLowerCase();
    if (fields.some((f) => lk === f || lk.includes(f))) {
      const n = toNum(obj[k]);
      if (obj[k] != null && obj[k] !== "" && !isNaN(n)) return { field: k, value: n };
    }
  }
  for (const k of Object.keys(obj)) {
    const r = deepFindNumber(obj[k], fields, depth + 1);
    if (r) return r;
  }
  return null;
}

export async function nbProbeBalance() {
  const results: any[] = [];
  let found: { path: string; field: string; value: number } | null = null;
  for (const p of BALANCE_PATHS) {
    try {
      const res = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" }, cache: "no-store" });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      const guess = json ? deepFindNumber(json.data ?? json, BALANCE_FIELDS) : null;
      results.push({ path: p, status: res.status, ok: res.ok, body: text.slice(0, 400), guess });
      if (!found && res.ok && json && json.success !== false && guess) found = { path: p, ...guess };
    } catch (e: any) {
      results.push({ path: p, error: e.message });
    }
  }
  return { found, results };
}

// ---- Per-product COGS uit NicheBay order-regels ----
const LINE_ARRAY_FIELDS = ["items", "order_items", "orderItems", "goods", "goods_list", "goodsList", "products", "product_list", "productList", "details", "detail", "sku_list", "skuList", "line_items", "lineItems", "order_goods", "order_detail"];
const NAME_FIELDS = ["product_name", "productName", "goods_name", "goodsName", "name", "title", "product_title", "spu_name", "spuName", "goods_title"];
const SKU_FIELDS = ["sku", "sku_no", "skuNo", "sku_code", "skuCode", "variant_sku", "variantSku", "spu", "spu_no"];
const UNITCOST_FIELDS = ["unit_cost", "unitCost", "cost_price", "costPrice", "purchase_price", "purchasePrice", "unit_price", "unitPrice", "store_pay_fee", "pay_fee", "cost", "price", "settle_price", "settlePrice", "goods_cost", "product_cost"];
const QTY_FIELDS = ["quantity", "qty", "num", "count", "amount", "number"];

function findLineItems(order: any): any[] {
  for (const f of LINE_ARRAY_FIELDS) if (Array.isArray(order?.[f])) return order[f];
  // zoek 1 niveau diep
  for (const k of Object.keys(order || {})) {
    const v = order[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      if (v[0] && (pick(v[0], NAME_FIELDS) || pick(v[0], SKU_FIELDS))) return v;
    }
  }
  return [];
}

export async function fetchNicheBayProductCosts(maxPages = 30, limit = 100) {
  const prod: Record<string, { name: string; sku: string; clean: number[]; alloc: number[]; last: number; lastDate: number }> = {};
  let sampleOrder: any = null;
  let sampleLine: any = null;
  let ordersSeen = 0;
  const LINE_PRICE_FIELDS = ["currency_price", "presentment_price", "price", "unit_price"];
  for (let page = 1; page <= maxPages; page++) {
    const j = await nbGet(`/orders?page=${page}&limit=${limit}`);
    const list = extractList(j);
    if (!Array.isArray(list) || list.length === 0) break;
    if (!sampleOrder) sampleOrder = list[0];
    for (const o of list) {
      ordersSeen++;
      const orderCost = toNum(pick(o, COST_FIELDS)); // store_pay_fee = totale inkoop van deze order
      const lines = findLineItems(o);
      if (!lines.length || orderCost <= 0) continue;
      const when = toNum(o.paid_at || o.created_at || 0);
      // gewicht per regel = verkoopprijs × aantal
      const weights = lines.map((li: any) => Math.max(1, toNum(pick(li, QTY_FIELDS)) || 1) * (toNum(pick(li, LINE_PRICE_FIELDS)) || 1));
      const totW = weights.reduce((a, b) => a + b, 0) || lines.length;
      lines.forEach((li: any, i: number) => {
        if (!sampleLine) sampleLine = li;
        const name = String(pick(li, NAME_FIELDS) || "").trim();
        const sku = String(pick(li, SKU_FIELDS) || "").trim();
        const qty = Math.max(1, toNum(pick(li, QTY_FIELDS)) || 1);
        if (!name && !sku) return;
        const allocated = lines.length === 1 ? orderCost : orderCost * (weights[i] / totW);
        const unit = allocated / qty;
        if (unit <= 0) return;
        const key = (sku || name).toLowerCase();
        const p = prod[key] || (prod[key] = { name: name || sku, sku, clean: [], alloc: [], last: 0, lastDate: 0 });
        if (name && !p.name) p.name = name;
        if (lines.length === 1) p.clean.push(unit); else p.alloc.push(unit);
        if (when >= p.lastDate) { p.lastDate = when; p.last = unit; }
      });
    }
    if (list.length < limit) break;
  }
  const products = Object.values(prod).map((p) => {
    const src = p.clean.length ? p.clean : p.alloc;
    const avg = src.length ? src.reduce((a, b) => a + b, 0) / src.length : 0;
    return {
      name: p.name, sku: p.sku,
      avgCost: Math.round(avg * 100) / 100,
      lastCost: Math.round(p.last * 100) / 100,
      orders: p.clean.length + p.alloc.length,
      basis: p.clean.length ? "single-item" : "verdeeld",
    };
  }).sort((a, b) => b.avgCost - a.avgCost);
  return { products, ordersSeen, sampleOrder, sampleLine };
}

// ---- Productcatalogus-probe: zoekt het juiste endpoint voor huidige inkoopprijs per product ----
export async function nbCatalogProbe() {
  const candidates = [
    "/products?page=1&limit=5", "/product/list?page=1&limit=5", "/product?page=1&limit=5",
    "/goods?page=1&limit=5", "/goods/list?page=1&limit=5", "/goods/page?page=1&limit=5",
    "/store/products?page=1&limit=5", "/store/goods?page=1&limit=5",
    "/sku?page=1&limit=5", "/sku/list?page=1&limit=5", "/product/page?page=1&limit=5",
    "/spu?page=1&limit=5", "/spu/list?page=1&limit=5", "/catalog?page=1&limit=5",
  ];
  const results: any[] = [];
  for (const path of candidates) {
    try {
      const j = await nbGet(path);
      const list = extractList(j);
      results.push({
        path,
        ok: true,
        count: Array.isArray(list) ? list.length : 0,
        keys: list && list[0] ? Object.keys(list[0]) : (j?.data ? Object.keys(j.data) : Object.keys(j || {})),
        sample: (list && list[0]) || j?.data || j || null,
      });
      if (Array.isArray(list) && list.length) break; // gevonden
    } catch (e: any) {
      results.push({ path, ok: false, error: String(e.message).slice(0, 120) });
    }
  }
  return results;
}

// ---- Huidige inkoopprijs per product uit orders (incl. tax via store_pay_fee) ----
const VARIANT_FIELDS = ["variant_id", "variantId", "variant_no", "shopify_variant_id", "sku_id", "skuId"];
const PRODUCTID_FIELDS = ["product_id", "productId", "shopify_product_id", "spu_id"];

export function nbNormName(s: string): string {
  return String(s || "").replace(/™|®/g, "").replace(/\s[–—|].*$/, "").replace(/\s-\s.*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Geeft huidige (meest recente) all-in inkoopprijs per product, gekeyd op Shopify variant-id én op genormaliseerde naam.
export async function fetchNicheBayCurrentCosts(maxPages = 30, limit = 100) {
  type P = { name: string; variantId: string; cleanLast: number; cleanDate: number; anyLast: number; anyDate: number; orders: number };
  const byVar: Record<string, P> = {};
  const byName: Record<string, P> = {};
  const LINE_PRICE_FIELDS = ["currency_price", "presentment_price", "price", "unit_price"];
  let ordersSeen = 0;
  const upd = (m: Record<string, P>, key: string, name: string, vid: string, unit: number, single: boolean, when: number) => {
    const p = m[key] || (m[key] = { name, variantId: vid, cleanLast: 0, cleanDate: 0, anyLast: 0, anyDate: 0, orders: 0 });
    if (name && !p.name) p.name = name;
    if (vid && !p.variantId) p.variantId = vid;
    p.orders++;
    if (when >= p.anyDate) { p.anyDate = when; p.anyLast = unit; }
    if (single && when >= p.cleanDate) { p.cleanDate = when; p.cleanLast = unit; }
  };
  for (let page = 1; page <= maxPages; page++) {
    const j = await nbGet(`/orders?page=${page}&limit=${limit}`);
    const list = extractList(j);
    if (!Array.isArray(list) || list.length === 0) break;
    for (const o of list) {
      ordersSeen++;
      const orderCost = toNum(pick(o, COST_FIELDS));
      const lines = findLineItems(o);
      if (!lines.length || orderCost <= 0) continue;
      const when = toNum(o.paid_at || o.created_at || 0);
      const single = lines.length === 1;
      const weights = lines.map((li: any) => Math.max(1, toNum(pick(li, QTY_FIELDS)) || 1) * (toNum(pick(li, LINE_PRICE_FIELDS)) || 1));
      const totW = weights.reduce((a, b) => a + b, 0) || lines.length;
      lines.forEach((li: any, i: number) => {
        const name = String(pick(li, NAME_FIELDS) || "").trim();
        const vid = String(pick(li, VARIANT_FIELDS) || "").trim();
        const qty = Math.max(1, toNum(pick(li, QTY_FIELDS)) || 1);
        if (!name && !vid) return;
        const allocated = single ? orderCost : orderCost * (weights[i] / totW);
        const unit = allocated / qty;
        if (unit <= 0) return;
        if (vid) upd(byVar, vid, name, vid, unit, single, when);
        if (name) upd(byName, nbNormName(name), name, vid, unit, single, when);
      });
    }
    if (list.length < limit) break;
  }
  const flat = (p: P) => ({ name: p.name, variantId: p.variantId, cost: Math.round((p.cleanLast || p.anyLast) * 100) / 100, orders: p.orders, basis: p.cleanLast ? "single-item" : "verdeeld" });
  const outVar: Record<string, any> = {}; for (const [k, v] of Object.entries(byVar)) outVar[k] = flat(v);
  const outName: Record<string, any> = {}; for (const [k, v] of Object.entries(byName)) outName[k] = flat(v);
  return { byVariant: outVar, byName: outName, ordersSeen };
}

// ---- Marge per product PER LAND uit orders ----
// verkoop = meest voorkomende currency_price in dat land (≈ listprijs), cogs = recentste store_pay_fee (incl. tax)
export async function fetchNicheBayProductCountry(maxPages = 30, limit = 100) {
  type Agg = {
    name: string; variantId: string; currency: string;
    sellCounts: Record<string, number>;
    cogsCleanLast: number; cogsCleanDate: number; cogsAnyLast: number; cogsAnyDate: number;
    orders: number; units: number;
  };
  const map: Record<string, Agg> = {}; // key = `${country}|${prodKey}`
  const countryOrders: Record<string, number> = {};
  const LINE_PRICE_FIELDS = ["currency_price", "presentment_price", "price", "unit_price"];
  let ordersSeen = 0;
  for (let page = 1; page <= maxPages; page++) {
    const j = await nbGet(`/orders?page=${page}&limit=${limit}`);
    const list = extractList(j);
    if (!Array.isArray(list) || list.length === 0) break;
    for (const o of list) {
      ordersSeen++;
      const orderCost = toNum(pick(o, COST_FIELDS));
      const lines = findLineItems(o);
      if (!lines.length || orderCost <= 0) continue;
      const cc = String(o?.address?.country || o?.country || "??").toUpperCase();
      const cur = String(o?.currency || o?.store_currency || "EUR").toUpperCase();
      const when = toNum(o.paid_at || o.created_at || 0);
      const single = lines.length === 1;
      countryOrders[cc] = (countryOrders[cc] || 0) + 1;
      const weights = lines.map((li: any) => Math.max(1, toNum(pick(li, QTY_FIELDS)) || 1) * (toNum(pick(li, LINE_PRICE_FIELDS)) || 1));
      const totW = weights.reduce((a, b) => a + b, 0) || lines.length;
      lines.forEach((li: any, i: number) => {
        const name = String(pick(li, NAME_FIELDS) || "").trim();
        const vid = String(pick(li, VARIANT_FIELDS) || "").trim();
        const qty = Math.max(1, toNum(pick(li, QTY_FIELDS)) || 1);
        if (!name && !vid) return;
        const prodKey = vid || "n:" + nbNormName(name);
        const key = `${cc}|${prodKey}`;
        const a = map[key] || (map[key] = { name: name || vid, variantId: vid, currency: cur, sellCounts: {}, cogsCleanLast: 0, cogsCleanDate: 0, cogsAnyLast: 0, cogsAnyDate: 0, orders: 0, units: 0 });
        if (name && !a.name) a.name = name;
        if (vid && !a.variantId) a.variantId = vid;
        a.orders++;
        a.units += qty;
        const sell = toNum(pick(li, LINE_PRICE_FIELDS));
        if (sell > 0) { const b = sell.toFixed(2); a.sellCounts[b] = (a.sellCounts[b] || 0) + 1; }
        const cogsUnit = (single ? orderCost : orderCost * (weights[i] / totW)) / qty;
        if (cogsUnit > 0) {
          if (when >= a.cogsAnyDate) { a.cogsAnyDate = when; a.cogsAnyLast = cogsUnit; }
          if (single && when >= a.cogsCleanDate) { a.cogsCleanDate = when; a.cogsCleanLast = cogsUnit; }
        }
      });
    }
    if (list.length < limit) break;
  }
  const mode = (m: Record<string, number>) => {
    let best = ""; let n = -1;
    for (const [k, v] of Object.entries(m)) if (v > n) { n = v; best = k; }
    return best ? Number(best) : 0;
  };
  const rows = Object.entries(map).map(([key, a]) => {
    const cc = key.split("|")[0];
    return {
      country: cc, name: a.name, variantId: a.variantId, currency: a.currency,
      verkoop: Math.round(mode(a.sellCounts) * 100) / 100,
      cogs: Math.round((a.cogsCleanLast || a.cogsAnyLast) * 100) / 100,
      basis: a.cogsCleanLast ? "single-item" : "verdeeld",
      orders: a.orders, units: a.units,
    };
  });
  const countries = Object.entries(countryOrders).map(([code, n]) => ({ code, orders: n })).sort((x, y) => y.orders - x.orders);
  return { rows, countries, ordersSeen };
}
