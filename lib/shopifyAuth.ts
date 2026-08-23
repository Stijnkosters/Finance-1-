import crypto from "crypto";
import { readJson, writeJson } from "@/lib/store";
import { getShop, type ShopCfg } from "@/lib/shops";

// OAuth-koppeling met Shopify (Dev Dashboard app). We halen eenmalig een
// offline access token op en bewaren dat op het volume. Dat token werkt in
// exact dezelfde header (X-Shopify-Access-Token) als een klassieke shpat-token.

// read_customers is nodig omdat de orders-query customer.id ophaalt
// (herhaalklanten, orders-per-klant, LTV).
export const OAUTH_SCOPES = "read_orders,read_products,read_customers";

export function oauthFile(shopId: string) {
  return `shopify-oauth-${shopId}.json`;
}

type StoredOAuth = { shop: string; token: string; scope?: string; obtainedAt?: string };

export async function getStoredOAuth(shopId: string): Promise<StoredOAuth | null> {
  const d = await readJson(oauthFile(shopId), null);
  return d && d.token ? d : null;
}

export async function saveOAuth(shopId: string, data: { shop: string; token: string; scope?: string }) {
  await writeJson(oauthFile(shopId), { ...data, obtainedAt: new Date().toISOString() });
}

// Effectieve Shopify-credentials voor een shop: env-token wint (bv. Drivemax),
// anders het via OAuth opgeslagen token (bv. Homivo). Store-domein uit env.
export async function resolveShopifyCfg(shop: ShopCfg): Promise<{ store?: string; token?: string }> {
  if (shop.shopify.token) return { store: shop.shopify.store, token: shop.shopify.token };
  const o = await getStoredOAuth(shop.id);
  return { store: shop.shopify.store || o?.shop, token: o?.token };
}

export async function shopHasCredentials(shop: ShopCfg): Promise<boolean> {
  const c = await resolveShopifyCfg(shop);
  return !!(c.store && c.token);
}

export function clientId() {
  return process.env.SHOPIFY_CLIENT_ID || "";
}
export function clientSecret() {
  return process.env.SHOPIFY_CLIENT_SECRET || "";
}

export function storeDomainFor(shopId: string): string | undefined {
  return getShop(shopId).shopify.store;
}

// --- OAuth-hulpjes ---

// Ondertekende state (CSRF): bevat shopId + nonce, gesigneerd met client secret.
export function makeState(shopId: string): string {
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = `${shopId}:${nonce}`;
  const sig = crypto.createHmac("sha256", clientSecret()).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

export function readState(state: string): { shopId: string } | null {
  const parts = (state || "").split(":");
  if (parts.length !== 3) return null;
  const [shopId, nonce, sig] = parts;
  const expect = crypto.createHmac("sha256", clientSecret()).update(`${shopId}:${nonce}`).digest("hex");
  if (!timingEqual(sig, expect)) return null;
  return { shopId };
}

// Shopify tekent de OAuth-callback met een hmac over de overige query-params.
export function verifyShopifyHmac(params: URLSearchParams): boolean {
  const hmac = params.get("hmac") || "";
  const pairs: string[] = [];
  params.forEach((v, k) => {
    if (k === "hmac" || k === "signature") return;
    pairs.push(`${k}=${v}`);
  });
  pairs.sort();
  const digest = crypto.createHmac("sha256", clientSecret()).update(pairs.join("&")).digest("hex");
  return timingEqual(hmac, digest);
}

export function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
