import { fetchNicheBayProductCountry, nichebayConfigured } from "@/lib/nichebay";

const FEE_RATE = 0.018;
const FEE_FIXED = 0.25;

export async function computeProductMargins() {
  if (!nichebayConfigured()) throw new Error("NICHEBAY_API_KEY ontbreekt.");
  const { rows: raw, countries, ordersSeen } = await fetchNicheBayProductCountry(30, 100);

  const rows = raw
    .filter((r) => r.verkoop > 0 && r.cogs > 0)
    .map((r) => {
      const fees = Math.round((r.verkoop * FEE_RATE + FEE_FIXED) * 100) / 100;
      const winst = Math.round((r.verkoop - r.cogs - fees) * 100) / 100;
      const margePct = Math.round((winst / r.verkoop) * 1000) / 10;
      const breakevenRoas = winst > 0 ? Math.round((r.verkoop / winst) * 100) / 100 : null;
      return {
        country: r.country, product: r.name, sku: r.variantId, currency: r.currency,
        verkoop: r.verkoop, cogs: r.cogs, fees, winst, margePct, breakevenRoas,
        orders: r.orders, basis: r.basis,
      };
    })
    .sort((a, b) => (a.country === b.country ? (b.breakevenRoas ?? -1) - (a.breakevenRoas ?? -1) : a.country < b.country ? -1 : 1));

  return { generatedAt: new Date().toISOString(), ordersSeen, countries, count: rows.length, rows };
}
