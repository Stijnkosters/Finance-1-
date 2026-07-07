import { fetchNicheBayProductCountry, nichebayConfigured } from "@/lib/nichebay";
import overrides from "@/data/cogs-overrides.json";

const FEE_RATE = 0.018;
const FEE_FIXED = 0.25;

export async function computeProductMargins() {
  if (!nichebayConfigured()) throw new Error("NICHEBAY_API_KEY ontbreekt.");
  const { rows: raw, countries, ordersSeen } = await fetchNicheBayProductCountry(30, 100);

  const hide = ((overrides as any).hideContains || []).map((s: string) => s.toLowerCase());
  const add: Record<string, number> = (overrides as any).addContains || {};

  const rows = raw
    .filter((r) => r.verkoop > 0 && r.cogs > 0)
    .map((r) => {
      const nameL = r.name.toLowerCase();
      if (hide.some((h: string) => nameL.includes(h))) return null;
      let cogs = r.cogs;
      let adjusted = false;
      for (const [k, amt] of Object.entries(add)) {
        if (nameL.includes(k.toLowerCase())) { cogs = Math.round((cogs + amt) * 100) / 100; adjusted = true; }
      }
      const fees = Math.round((r.verkoop * FEE_RATE + FEE_FIXED) * 100) / 100;
      const winst = Math.round((r.verkoop - cogs - fees) * 100) / 100;
      const margePct = Math.round((winst / r.verkoop) * 1000) / 10;
      const breakevenRoas = winst > 0 ? Math.round((r.verkoop / winst) * 100) / 100 : null;
      return {
        country: r.country, product: r.name, sku: r.variantId, currency: r.currency,
        verkoop: r.verkoop, cogs, fees, winst, margePct, breakevenRoas,
        orders: r.orders, basis: r.basis, adjusted,
      };
    })
    .filter(Boolean) as any[];

  rows.sort((a, b) => (a.country === b.country ? (b.breakevenRoas ?? -1) - (a.breakevenRoas ?? -1) : a.country < b.country ? -1 : 1));
  return { generatedAt: new Date().toISOString(), ordersSeen, countries, count: rows.length, rows };
}
