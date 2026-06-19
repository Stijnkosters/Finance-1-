# Drivemax Profit Cockpit

Dagelijkse P&L-app die je **Shopify-orders automatisch ophaalt** en elke orderregel matcht aan je **inkoopprijs** uit `data/costs.json`. Zo zie je je echte **COGS / wat je betaalt** per dag, plus omzet, refunds, fees, advertentiekosten en netto winst — zonder handmatig invoeren.

## Wat het doet
- Haalt orders uit de Shopify Admin API (op datum).
- Berekent **COGS = aantal verkocht × inkoopprijs** per product (uit `costs.json`).
- Rekent per dag: omzet, refunds, COGS, geschatte Shopify-fees, ad spend → **dagwinst**.
- Trekt je overhead (`expenses.json`) eraf voor je **netto resultaat**.
- Toont cockpit-dashboard: trend omhoog/omlaag, KPI's, kostenuitsplitsing, cashpositie.

## Stap 1 — Shopify token aanmaken
1. Shopify Admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. **Configure Admin API scopes** → vink aan: `read_orders`, `read_products`. (Voor historie ouder dan 60 dagen ook `read_all_orders` aanvragen.)
3. **Install app** → kopieer de **Admin API access token** (`shpat_...`).
4. Je store-domain is `drivemax.myshopify.com` (het interne domein, niet drivemax.nl).

## Stap 2 — Lokaal draaien (optioneel)
```bash
npm install
cp .env.example .env.local      # vul je token in
npm run dev                     # http://localhost:3000
```

## Stap 3 — Naar GitHub
```bash
git init
git add .
git commit -m "Drivemax Profit Cockpit"
git branch -M main
git remote add origin https://github.com/<jouw-user>/drivemax-cockpit.git
git push -u origin main
```

## Stap 4 — Deploy op Vercel (gratis)
1. Ga naar vercel.com → **Add New → Project** → kies je GitHub-repo.
2. **Environment Variables** → voeg toe (uit `.env.example`):
   - `SHOPIFY_STORE_DOMAIN` = `drivemax.myshopify.com`
   - `SHOPIFY_ADMIN_TOKEN` = je `shpat_...` token
   - `SHOPIFY_API_VERSION` = `2026-01`
   - `FEE_RATE` = `0.018` · `FEE_FIXED` = `0.25`
3. **Deploy**. Klaar — open de URL en je P&L staat er live.

> Belangrijk: zet je token alleen in Vercel env vars, **nooit** in de code of in GitHub.

## Stap 5 — Inkoopprijzen invullen (de enige handmatige stap)
Open `data/costs.json` en zet bij elk product je **inkoopprijs** (`cost`) in EUR. Tel er eventueel je inbound shipping per stuk bij op. Commit + push → Vercel deployt automatisch opnieuw.

Producten zonder inkoop (cadeaukaart, e-book, garantie) laat je op `0`.

Verkoop je een nieuw product? Voeg het toe met zijn **variant-GID** als key. De app meldt op het dashboard welke verkochte varianten nog ontbreken.

## Google Ads koppelen (advertentiekosten automatisch)

De app trekt ad spend per dag binnen en verwerkt het in je P&L. Kies één route:

### Route A — directe Google Ads API (gratis, self-contained)
Zwaarste setup, maar daarna volledig automatisch.
1. **Developer token**: ga naar `ads.google.com/aw/apicenter` in een **Manager (MCC) account** → vul de API-access form in → vraag **Basic access** aan (productie). Approval kan een paar dagen duren.
2. **OAuth client**: Google Cloud Console → nieuw project → **Enable** de Google Ads API → **Credentials** → OAuth client (type: Desktop). Noteer client ID + secret.
3. **Refresh token**: open de [OAuth2 Playground](https://developers.google.com/oauthplayground) → tandwiel rechtsboven → "Use your own OAuth credentials" → vul client ID/secret in → autoriseer scope `https://www.googleapis.com/auth/adwords` → "Exchange authorization code for tokens" → kopieer de **refresh token**.
4. **Customer ID**: je Drivemax ads-account-ID (10 cijfers, zonder streepjes). MCC-id = `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
5. Zet alle `GOOGLE_ADS_*` env vars in Vercel → redeploy. Klaar: de KPI toont "Ad spend · Google Ads".

### Route B — Google Sheet CSV (geen developer token)
Veel minder gedoe.
1. Maak in Google Ads een **scheduled report** (of een Make/n8n-flow) die dagelijks **datum + kosten** naar een Google Sheet schrijft.
2. Sheet → **Bestand → Delen → Publiceren op internet** → kies de tab, formaat **CSV** → kopieer de URL.
3. Zet die URL als `GOOGLE_SHEET_CSV_URL` in Vercel. De app leest 'm (kolommen `date` + `cost`).

### Geen van beide?
Laat de env vars leeg en vul `data/adspend.json` handmatig (datum → bedrag). De app valt daar automatisch op terug.

> Meta/TikTok werken straks identiek: zelfde patroon, andere bron. Vraag het als je die erbij wil.


- `data/costs.json` — inkoopprijs per product (jij vult in). **Bron van je COGS.**
- `data/adspend.json` — advertentiekosten per dag (handmatig of later via Make/n8n).
- `data/expenses.json` — overhead/uitgaves.
- `data/accounts.json` — saldi + openstaande facturen (cashpositie).
- `app/api/pl/route.ts` — de engine: orders → COGS → dag-P&L.
- `lib/shopify.ts` — Shopify GraphQL-client.

## NicheBay koppelen (kostprijs / COGS automatisch)

In plaats van `costs.json` handmatig in te vullen, haalt de app de kostprijs per order rechtstreeks uit NicheBay en matcht die op je Shopify-ordernummer.

1. NicheBay → Settings → **API Settings** → maak een API key (`sk_...`).
2. Zet als env var: `NICHEBAY_API_KEY` = je `sk_...` key.
3. **Verifieer**: open `https://<jouw-app-url>/api/nichebay`. Je ziet een `sampleOrder` (ruwe NicheBay-data) en `matchedOrders`. Werkt het, dan toont het dashboard "COGS · NicheBay".
4. 0 matches? Stuur me de `sampleOrder`-JSON — dan zet ik de exacte veldnamen goed (de NicheBay-doc toont de response-schema's niet, dus de app raadt nu de gangbare namen).

> Base URL: `https://dashboard-admin.nichebay.com/api/open/v1` · Auth: `Authorization: Bearer sk_...`. Orders zonder NicheBay-kost (SD-kaart, cadeaukaart) vallen terug op `costs.json`.

## Later automatiseren (geen handwerk meer)
- **Ad spend** → Make/n8n-flow die dagelijks Google Ads + Meta-spend naar `adspend.json` (of een DB) schrijft.
- **Inkoopprijzen** → als je leverancier een API/prijsfeed heeft, laat die `costs.json` updaten.
- **Overhead** → bank-API's (Wise/Revolut/Bunq) → `expenses.json` met keyword-regels.

## Let op
- Shopify-fees zijn een **schatting** (`FEE_RATE`/`FEE_FIXED`). Voor exacte fees is de Shopify Payments balance-API nodig (extra scope) — kan later.
- Omzet = order-subtotaal (na korting, vóór verzending/btw), zodat het matcht met je P&L-logica.
