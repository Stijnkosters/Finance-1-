const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

export async function shopifyGraphQL(query: string, variables: any = {}) {
  if (!STORE || !TOKEN) {
    throw new Error("Ontbrekende env vars: SHOPIFY_STORE_DOMAIN en/of SHOPIFY_ADMIN_TOKEN");
  }
  const res = await fetch(`https://${STORE}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

const ORDERS_QUERY = `
query Orders($cursor: String, $q: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      subtotalPriceSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      lineItems(first: 50) {
        nodes {
          quantity
          title
          variant { id }
        }
      }
    }
  }
}`;

export async function fetchOrders(from: string, to: string) {
  // from/to: YYYY-MM-DD (inclusief). Shopify query op created_at.
  const q = `created_at:>='${from}T00:00:00Z' created_at:<='${to}T23:59:59Z'`;
  let cursor: string | null = null;
  const out: any[] = [];
  for (let i = 0; i < 50; i++) {
    const data = await shopifyGraphQL(ORDERS_QUERY, { cursor, q });
    const conn = data.orders;
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}
