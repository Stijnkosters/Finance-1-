// Parser voor de dagelijkse Win-Win Fulfillment "INVOICE LIST" (leverancier
// van o.a. Homivo). Zet de factuurtekst om naar exacte inkoop (COGS) per order.
//
// Voorbeeldregel uit de PDF-tekstlaag:
//   13220236132678 1246 2026/8/4 LumiForge 2 Netherlands 3 36.5
//   <ordernr>       <txn> <datum>  <product> <qty> <land>  <duty> <prijs €>
//
// - "Order number" = het Shopify-ordernummer/-id dat de app ook gebruikt om te matchen.
// - Een order kan over meerdere regels gesplitst zijn (bv. 13243698086214 en
//   13243698086214_1); die tellen we bij elkaar op tot één ordertotaal.
// - "Total price (€)" is de inkoopprijs incl. duty die wij aan de leverancier betalen.

export type WinWinLine = {
  orderId: string; // basis-ordernummer (zonder _n suffix)
  raw: string; // ordernummer zoals in de PDF (kan _n bevatten)
  txn: string;
  date: string;
  product: string;
  qty: number;
  country: string;
  duty: number;
  price: number;
};

export type WinWinParsed = {
  invoiceNo: string | null;
  invoiceDate: string | null;
  lines: WinWinLine[];
  orders: Record<string, number>; // orderId -> som van price (exacte COGS)
  orderCount: number; // aantal unieke orders
  total: number; // som van alle regels (moet ~= factuurtotaal zijn)
};

const numTok = (s: string) => parseFloat(s.replace(",", "."));

export function parseWinWinInvoice(text: string): WinWinParsed {
  const invoiceNo = (text.match(/Invoice\s*number:\s*(\S+)/i)?.[1] || null);
  // Datum staat als "14,August,2026" — geen spaties, dus stopt vanzelf.
  const invoiceDate = (text.match(/Invoice\s*date:\s*([0-9A-Za-z,]+)/i)?.[1]?.trim() || null);

  // We matchen elke orderregel met één globale regex i.p.v. per tekstregel.
  // Zo werkt het ook als de PDF-tekstlaag de regels aan elkaar plakt of juist
  // opknipt. Velden op volgorde:
  //   ordernr[_n]  txn  datum(YYYY/M/D)  product…  qty  land  duty  prijs
  const rowRe =
    /(\d{6,}(?:_\d+)?)\s+(\d+)\s+(\d{4}\/\d{1,2}\/\d{1,2})\s+(.+?)\s+(\d+)\s+([A-Za-z][A-Za-z. ]*?)\s+(\d+)\s+(\d+(?:[.,]\d+)?)(?=\s|$)/g;

  const lines: WinWinLine[] = [];
  for (const m of text.matchAll(rowRe)) {
    const rawOrder = m[1];
    const price = numTok(m[8]);
    if (!isFinite(price)) continue;
    lines.push({
      orderId: rawOrder.replace(/_\d+$/, ""),
      raw: rawOrder,
      txn: m[2],
      date: m[3],
      product: m[4].trim(),
      qty: parseInt(m[5], 10) || 0,
      country: m[6].trim(),
      duty: numTok(m[7]) || 0,
      price,
    });
  }

  const orders: Record<string, number> = {};
  let total = 0;
  for (const l of lines) {
    orders[l.orderId] = round2((orders[l.orderId] || 0) + l.price);
    total += l.price;
  }

  return {
    invoiceNo,
    invoiceDate,
    lines,
    orders,
    orderCount: Object.keys(orders).length,
    total: round2(total),
  };
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
