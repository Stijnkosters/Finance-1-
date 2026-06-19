// Wise (TransferWise) API: haalt je actuele saldo per valuta op.
// Vereist een read-only API-token (Wise → Settings → API tokens).
const BASE = process.env.WISE_API_BASE || "https://api.wise.com";
const TOKEN = process.env.WISE_API_TOKEN || "";

export function wiseConfigured() {
  return !!TOKEN;
}

async function wiseGet(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

export async function wiseBalances() {
  if (!TOKEN) throw new Error("WISE_API_TOKEN ontbreekt.");

  // 1) profielen ophalen (zakelijk profiel heeft de voorkeur)
  let prof = await wiseGet("/v2/profiles");
  if (!prof.ok) prof = await wiseGet("/v1/profiles"); // fallback oudere versie
  if (!prof.ok) throw new Error(`Wise profielen ${prof.status}: ${prof.text.slice(0, 200)}`);
  const profiles = Array.isArray(prof.json) ? prof.json : [];
  const profile = profiles.find((p: any) => p.type === "business") || profiles[0];
  if (!profile) throw new Error("Geen Wise-profiel gevonden bij dit token.");
  const profileId = profile.id;

  // 2) saldo's ophalen (v4), met fallback naar de oudere borderless-accounts
  let bal = await wiseGet(`/v4/profiles/${profileId}/balances?types=STANDARD`);
  let list: { currency: string; value: number }[] = [];
  if (bal.ok && Array.isArray(bal.json)) {
    list = bal.json.map((b: any) => ({
      currency: b.amount?.currency || b.currency,
      value: Number(b.amount?.value ?? b.value ?? 0),
    }));
  } else {
    const legacy = await wiseGet(`/v1/borderless-accounts?profileId=${profileId}`);
    if (legacy.ok && Array.isArray(legacy.json)) {
      for (const acc of legacy.json) {
        for (const b of acc.balances || []) {
          list.push({ currency: b.currency, value: Number(b.amount?.value ?? 0) });
        }
      }
    } else {
      throw new Error(`Wise saldo ${bal.status}: ${bal.text.slice(0, 200)}`);
    }
  }

  list = list.filter((b) => b.currency);
  const eur = list.filter((b) => b.currency === "EUR").reduce((a, b) => a + b.value, 0);
  return { profileId, profileType: profile.type, list, eur };
}
