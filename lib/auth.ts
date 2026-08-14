// Simpele wachtwoord-gate voor de cockpit.
// De cookie bevat NOOIT het wachtwoord zelf, maar een HMAC-token dat we
// zowel in de middleware (edge) als in de API-route (node) opnieuw kunnen
// berekenen en vergelijken. Alleen Web Crypto → werkt in beide runtimes.

export const AUTH_COOKIE = "dm_auth";

// 30 dagen ingelogd blijven.
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30;

export async function authToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("drivemax-cockpit-v1"));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
