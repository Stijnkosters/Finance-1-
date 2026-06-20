// Wisselkoersen via Frankfurter (ECB-dagkoersen, gratis, geen key).
// Zet een vreemd-valuta bedrag om naar EUR op de transactiedatum.
const cache: Record<string, number | null> = {};
const BASE = process.env.FX_API_BASE || "https://api.frankfurter.app";

async function rateToEUR(currency: string, date: string): Promise<number | null> {
  const cur = (currency || "").toUpperCase();
  if (!cur || cur === "EUR") return 1;
  const key = `${date}:${cur}`;
  if (key in cache) return cache[key];
  try {
    // Frankfurter geeft op weekend/feestdag automatisch de laatste beschikbare koers
    const res = await fetch(`${BASE}/${date}?from=${cur}&to=EUR`, { cache: "no-store" });
    const j: any = await res.json().catch(() => ({}));
    const r = j?.rates?.EUR;
    cache[key] = typeof r === "number" ? r : null;
    return cache[key];
  } catch {
    cache[key] = null;
    return null;
  }
}

// Zet bedrag (met teken) om naar EUR. Lukt de koers niet, dan null (overslaan).
export async function toEUR(amount: number, currency: string, date: string): Promise<number | null> {
  const cur = (currency || "").toUpperCase();
  if (!cur || cur === "EUR") return amount;
  const rate = await rateToEUR(cur, date);
  if (rate == null) return null;
  return Math.round(amount * rate * 100) / 100;
}
