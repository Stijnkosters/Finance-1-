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

export async function fetchNicheBayProductCosts(maxPages = 20, limit = 100) {
  const prod: Record<string, { name: string; sku: string; costs: number[]; last: number }> = {};
  let sampleOrder: any = null;
  let sampleLine: any = null;
  let ordersSeen = 0;
  for (let page = 1; page <= maxPages; page++) {
    const j = await nbGet(`/orders?page=${page}&limit=${limit}`);
    const list = extractList(j);
    if (!Array.isArray(list) || list.length === 0) break;
    if (!sampleOrder) sampleOrder = list[0];
    for (const o of list) {
      ordersSeen++;
      const lines = findLineItems(o);
      for (const li of lines) {
        if (!sampleLine) sampleLine = li;
        const name = String(pick(li, NAME_FIELDS) || "").trim();
        const sku = String(pick(li, SKU_FIELDS) || "").trim();
        const qty = Math.max(1, toNum(pick(li, QTY_FIELDS)) || 1);
        const rawCost = toNum(pick(li, UNITCOST_FIELDS));
        if (!name && !sku) continue;
        const unit = rawCost > 0 ? rawCost / (rawCost > 200 && qty > 1 ? qty : 1) : 0; // ruwe unit-schatting
        const key = (sku || name).toLowerCase();
        const p = prod[key] || (prod[key] = { name: name || sku, sku, costs: [], last: 0 });
        if (name && !p.name) p.name = name;
        if (unit > 0) { p.costs.push(unit); p.last = unit; }
      }
    }
    if (list.length < limit) break;
  }
  const products = Object.values(prod).map((p) => {
    const avg = p.costs.length ? p.costs.reduce((a, b) => a + b, 0) / p.costs.length : 0;
    return { name: p.name, sku: p.sku, avgCost: Math.round(avg * 100) / 100, lastCost: Math.round(p.last * 100) / 100, orders: p.costs.length };
  }).sort((a, b) => b.avgCost - a.avgCost);
  return { products, ordersSeen, sampleOrder, sampleLine };
}
