// Parser voor de dagelijkse Win-Win Fulfillment "INVOICE LIST" (leverancier
// van o.a. Homivo). Zet de factuurtekst om naar exacte inkoop (COGS) per order.
//
// LET OP: pdf-parse levert de tabel ZONDER spaties tussen de kolommen, bv:
//   1322023613267812462026/8/4LumiForge2Netherlands336.5
//   = order 13220236132678 | txn 1246 | datum 2026/8/4 | LumiForge | qty 2 |
//     Netherlands | duty 3 | prijs 36.5
// We ankeren daarom op de datum (YYYY/M/D) en op de factuurtotalen.
//
// - "Order number" = het Shopify-ordernummer/-id waarop de app matcht.
// - Een order kan gesplitst zijn (13243698086214 en 13243698086214_1); die
//   tellen we bij elkaar op tot één ordertotaal.
// - "Total price (€)" is de inkoopprijs per orderregel; de som = factuurtotaal.

export type WinWinLine = {
  orderId: string; // basis-ordernummer (zonder _n suffix)
  raw: string; // ordernummer zoals in de PDF (kan _n bevatten)
  product: string;
  qty: number;
  country: string;
  price: number;
};

export type WinWinParsed = {
  invoiceNo: string | null;
  invoiceDate: string | null;
  lines: WinWinLine[];
  orders: Record<string, number>; // orderId -> som van price (exacte COGS)
  orderCount: number;
  total: number;
};

function toNum(s?: string | null): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : null;
}

export function parseWinWinInvoice(text: string): WinWinParsed {
  const t = text || "";

  const invoiceNo = t.match(/Invoice\s*number:\s*([A-Za-z0-9]+?)(?=\s|Invoice|$)/i)?.[1] || null;
  const invoiceDate = t.match(/Invoice\s*date:\s*([0-9A-Za-z,]+)/i)?.[1]?.trim() || null;

  // Totalen (voor validatie + duty/prijs-splitsing)
  const totalAmount = toNum(t.match(/TOTAL\s*AMOUNT\s*€?\s*([\d.,]+)/i)?.[1]);
  const totalDuty = toNum(t.match(/TOTAL\s*Duty\s*€?\s*([\d.,]+)/i)?.[1]);

  // Transactienummer-bereik (bv. "#1246 - #1251") om order-id van txn te scheiden.
  const rangeM = t.match(/#(\d+)\s*[-–]\s*#(\d+)/);
  const txnLo = rangeM ? parseInt(rangeM[1], 10) : null;
  const txnHi = rangeM ? parseInt(rangeM[2], 10) : null;

  // Elke datarij, ge-ankerd op de datum. Werkt zowel met als zonder spaties:
  //   <order+txn (digits/_/spaties)> <datum> <product> <qty> <land> <duty+prijs>
  // Product mag ELK teken bevatten (é, –, &, cijfers…). qty = getal, land = letters,
  // dutyPrice = duty+prijs aan elkaar (bv. "316.38" = duty 3 + prijs 16.38).
  const rowRe =
    /([\d_ ]+?)(\d{4}\/\d{1,2}\/\d{1,2})(.+?)(\d+)([A-Za-z][A-Za-z ]*?)(\d+\.\d+)(?=\s|$|\/)/g;

  type Raw = { orderId: string; txn: string; raw: string; product: string; qty: number; country: string; dutyPrice: string };
  const raws: Raw[] = [];

  for (const m of t.matchAll(rowRe)) {
    const pre = m[1].replace(/\s+/g, ""); // order-id + transactienummer, aan elkaar
    const oi = orderIdFrom(pre);
    if (!oi) continue;
    raws.push({
      orderId: oi.orderId,
      txn: oi.txn,
      raw: oi.orderId,
      product: m[3].trim(),
      qty: parseInt(m[4], 10) || 0,
      country: m[5].trim(),
      dutyPrice: m[6],
    });
  }

  // Duty van prijs splitsen. De duty is één leidend cijfer (0, 3, …) dat per rij
  // kan verschillen (bv. €0 voor oude, €3 voor recente orders). Daarom PER RIJ:
  // strip 1 leidend cijfer; lukt dat niet, val terug op de prijs zoals-ie is.
  const rowPrice = (dp: string): number => {
    const s1 = dp.replace(/^\d/, "");
    if (/^\d+\.\d+$/.test(s1)) return parseFloat(s1); // duty = 1 leidend cijfer
    if (/^\d+\.\d+$/.test(dp)) return parseFloat(dp); // geen duty-cijfer
    return parseFloat(dp) || 0;
  };
  let prices = raws.map((r) => rowPrice(r.dutyPrice));

  // Veiligheid: als het factuurtotaal betrouwbaar is én "geen duty" duidelijk beter
  // klopt (duty-kolom ontbrak), gebruik dan de onbewerkte prijzen.
  if (totalAmount != null && raws.length) {
    const noStrip = raws.map((r) => (/^\d+\.\d+$/.test(r.dutyPrice) ? parseFloat(r.dutyPrice) : NaN));
    if (noStrip.every((n) => isFinite(n))) {
      const tol = Math.max(0.05, totalAmount * 0.01);
      const errStrip = Math.abs(prices.reduce((a, b) => a + b, 0) - totalAmount);
      const errNo = Math.abs(noStrip.reduce((a, b) => a + b, 0) - totalAmount);
      if (errNo <= tol && errStrip > tol) prices = noStrip;
    }
  }

  const lines: WinWinLine[] = raws.map((r, i) => ({
    orderId: r.orderId, raw: r.raw, product: r.product, qty: r.qty, country: r.country, price: round2(prices![i]),
  }));

  // Eén Shopify-order kan over meerdere regels/dozen verstuurd zijn:
  //  - underscore-splits (…_1, …_2): zelfde order-id;
  //  - aparte dozen: verschillende order-ids, maar HETZELFDE transactienummer
  //    (= Shopify-ordernummer #).
  // We groeperen daarom per transactienummer (of order-id als txn ontbreekt),
  // tellen de dozen op, en bewaren dat ordertotaal onder ELKE order-id van de
  // groep én onder het transactienummer. Zo klopt de COGS ongeacht welk nummer
  // Shopify teruggeeft, en zijn split-orders compleet.
  const groups = new Map<string, { sum: number; orderIds: Set<string> }>();
  raws.forEach((r, i) => {
    const key = r.txn || r.orderId;
    const g = groups.get(key) || { sum: 0, orderIds: new Set<string>() };
    g.sum = round2(g.sum + round2(prices![i]));
    g.orderIds.add(r.orderId);
    groups.set(key, g);
  });

  const orders: Record<string, number> = {};
  let total = 0;
  for (const [key, g] of groups) {
    total = round2(total + g.sum);
    for (const oid of g.orderIds) orders[oid] = g.sum;
    if (/^\d{3,6}$/.test(key)) orders[key] = g.sum; // transactienummer = Shopify #
  }

  return { invoiceNo, invoiceDate, lines, orders, orderCount: groups.size, total: round2(total) };
}

// Order-id (14 cijfers) én transactienummer uit de aan-elkaar-geplakte cijfers.
// Formaat: <order-id (14)><transactienummer>, of split: <order-id>_<n><txn>.
// Shopify-order-ids zijn hier steevast 14 cijfers → neem de eerste 14; de rest
// is het transactienummer. Bij underscore-splits laten we txn leeg (die groeperen
// al op hun gedeelde order-id).
const SHOPIFY_ID_LEN = 14;
function orderIdFrom(pre: string): { orderId: string; txn: string } | null {
  if (!/^\d/.test(pre)) return null;
  const hasU = pre.includes("_");
  const base = hasU ? pre.split("_")[0] : pre;
  if (base.length < 12) return null; // te kort voor een echt order-id
  const orderId = base.slice(0, SHOPIFY_ID_LEN);
  const txn = !hasU && pre.length > SHOPIFY_ID_LEN ? pre.slice(SHOPIFY_ID_LEN) : "";
  return { orderId, txn };
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
