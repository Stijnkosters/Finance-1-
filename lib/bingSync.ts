import { fetchBingSpendByDay, bingApiConfigured } from "./bingAds";
import { readJson, writeJson, persistenceEnabled } from "./store";

let running = false;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Ververst de Bing-cache op de achtergrond als 'ie ouder is dan maxAgeHours.
// Fire-and-forget: blokkeert het dashboard niet. Werkt omdat Railway een langdraaiend Node-proces is.
export async function maybeAutoSyncBing(maxAgeHours = 8) {
  try {
    if (!bingApiConfigured() || !persistenceEnabled() || running) return;
    const cache: any = await readJson("bingspend.json", null);
    const age = cache?.updatedAt ? (Date.now() - new Date(cache.updatedAt).getTime()) / 3600000 : Infinity;
    if (age < maxAgeHours) return;
    running = true;
    (async () => {
      try {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 95);
        const map = await fetchBingSpendByDay(ymd(from), ymd(to));
        await writeJson("bingspend.json", { updatedAt: new Date().toISOString(), from: ymd(from), to: ymd(to), map });
      } catch {
        /* stil falen: dashboard toont dan gewoon de laatste cache */
      } finally {
        running = false;
      }
    })();
  } catch {
    running = false;
  }
}
