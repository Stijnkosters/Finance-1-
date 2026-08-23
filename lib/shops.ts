export type ShopCfg = {
  id: string;
  name: string;
  shopify: { store?: string; token?: string };
  ads: {
    googleSheetUrl?: string;
    bingSheetUrl?: string;
    bingCacheFile: string;
    useGoogleApi: boolean;
    googleCustomerId?: string;
  };
  costsKey: "drivemax" | "homivo";
  nichebay: boolean;
};

export const SHOPS: ShopCfg[] = [
  {
    id: "drivemax",
    name: "Drivemax",
    shopify: {
      store: process.env.SHOPIFY_STORE_DOMAIN,
      token: process.env.SHOPIFY_ADMIN_TOKEN,
    },
    ads: {
      googleSheetUrl: process.env.GOOGLE_SHEET_CSV_URL,
      bingSheetUrl: process.env.BING_SHEET_CSV_URL || process.env.MICROSOFT_SHEET_CSV_URL,
      bingCacheFile: "bingspend.json",
      useGoogleApi: true,
      googleCustomerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
    },
    costsKey: "drivemax",
    nichebay: true,
  },
  {
    id: "homivo",
    name: "Homivo",
    shopify: {
      store: process.env.HOMIVO_SHOPIFY_STORE_DOMAIN,
      token: process.env.HOMIVO_SHOPIFY_ADMIN_TOKEN,
    },
    ads: {
      googleSheetUrl: process.env.HOMIVO_GOOGLE_SHEET_CSV_URL,
      bingSheetUrl: process.env.HOMIVO_BING_SHEET_CSV_URL,
      bingCacheFile: "bingspend-homivo.json",
      useGoogleApi: true,
      googleCustomerId: process.env.HOMIVO_GOOGLE_ADS_CUSTOMER_ID,
    },
    costsKey: "homivo",
    nichebay: false,
  },
];

export function getShop(id?: string | null): ShopCfg {
  return SHOPS.find((s) => s.id === id) || SHOPS[0];
}

export function shopConfigured(s: ShopCfg): boolean {
  return !!(s.shopify.store && s.shopify.token);
}

export const SHOP_IDS = SHOPS.map((s) => s.id);
