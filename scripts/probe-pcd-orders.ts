/**
 * Probe: can the app offline token read Order fields (PCD) on Salt & Fern?
 * Never prints tokens. Exit 0 = readable, 2 = ACCESS_DENIED / not approved.
 *
 *   npx tsx --env-file=embedded/.env scripts/probe-pcd-orders.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const SHOP = "requisly.myshopify.com";
const API_VERSION = "2025-10";

const PROBE = `#graphql
  query PcdProbe {
    orders(first: 3, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id
        name
        processedAt
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 2) {
          nodes { title quantity sku }
        }
      }
    }
  }
`;

function loadEnvFiles() {
  for (const rel of ["embedded/.env", ".env.local", ".env"]) {
    const p = resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function loadOfflineToken(): Promise<{
  source: string;
  scope: string | null;
  accessToken: string;
  hasRefresh: boolean;
  hasExpires: boolean;
}> {
  // Prefer Postgres Session — offline with orders scope if present, else any offline.
  try {
    const prisma = new PrismaClient();
    const withOrders = await prisma.session.findFirst({
      where: {
        shop: SHOP,
        OR: [
          { scope: { contains: "read_orders" } },
          { scope: { contains: "write_orders" } },
        ],
      },
      orderBy: { id: "asc" },
    });
    const offline = withOrders
      ? null
      : await prisma.session.findFirst({
          where: { shop: SHOP, isOnline: false },
          orderBy: { id: "asc" },
        });
    const any = withOrders ?? offline ?? (await prisma.session.findFirst({
      where: { shop: SHOP },
    }));
    const all = await prisma.session.findMany({
      where: { shop: SHOP },
      select: { id: true, isOnline: true, scope: true, expires: true, refreshToken: true },
    });
    console.log(
      "sessions:",
      JSON.stringify(
        all.map((s) => ({
          isOnline: s.isOnline,
          scope: s.scope,
          has_refresh: Boolean(s.refreshToken),
          has_expires: s.expires != null,
        })),
      ),
    );
    await prisma.$disconnect();
    if (any?.accessToken) {
      return {
        source: withOrders
          ? any.isOnline
            ? "postgres_Session_online_with_orders"
            : "postgres_Session_with_orders"
          : "postgres_Session",
        scope: any.scope,
        accessToken: any.accessToken,
        hasRefresh: Boolean(any.refreshToken),
        hasExpires: any.expires != null,
      };
    }
  } catch (err) {
    console.log(
      "postgres_Session_lookup:",
      err instanceof Error ? err.message.slice(0, 120) : "failed",
    );
  }

  // Fallback: local SQLite from shopify app dev
  const dbPath = resolve(process.cwd(), "embedded/prisma/dev.sqlite");
  if (existsSync(dbPath)) {
    const py = `
import sqlite3, json
c = sqlite3.connect(r${JSON.stringify(dbPath)})
row = c.execute(
  "SELECT scope, accessToken, refreshToken, expires FROM Session WHERE shop = ? AND isOnline = 0 LIMIT 1",
  (${JSON.stringify(SHOP)},)
).fetchone()
if not row:
  row = c.execute(
    "SELECT scope, accessToken, refreshToken, expires FROM Session WHERE shop = ? LIMIT 1",
    (${JSON.stringify(SHOP)},)
  ).fetchone()
if not row:
  raise SystemExit("NO_SESSION")
print(json.dumps({
  "scope": row[0],
  "accessToken": row[1],
  "hasRefresh": bool(row[2]),
  "hasExpires": row[3] is not None,
}))
`;
    const out = execFileSync("python", ["-c", py], { encoding: "utf8" }).trim();
    if (out !== "NO_SESSION") {
      const parsed = JSON.parse(out) as {
        scope: string | null;
        accessToken: string;
        hasRefresh: boolean;
        hasExpires: boolean;
      };
      return { source: "sqlite_Session", ...parsed };
    }
  }

  throw new Error(`No Session row for ${SHOP}`);
}

async function main() {
  loadEnvFiles();

  const session = await loadOfflineToken();
  const scopes = (session.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  console.log(
    JSON.stringify(
      {
        shop: SHOP,
        token_source: session.source,
        has_read_orders: scopes.includes("read_orders"),
        has_write_orders: scopes.includes("write_orders"),
        has_refresh_token: session.hasRefresh,
        has_expires: session.hasExpires,
        scope_count: scopes.length,
      },
      null,
      2,
    ),
  );

  if (!scopes.includes("read_orders") && !scopes.includes("write_orders")) {
    console.log("RESULT: missing_orders_scope");
    process.exit(3);
  }

  const res = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query: PROBE }),
    },
  );
  const json = (await res.json()) as {
    data?: {
      orders?: {
        nodes?: Array<{
          id: string;
          name: string | null;
          processedAt: string | null;
          totalPriceSet?: { shopMoney?: { amount?: string } };
          lineItems?: { nodes?: unknown[] };
        }>;
      };
    };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };

  const errText = (json.errors ?? []).map((e) => e.message).join(" | ");
  const denied =
    /ACCESS_DENIED|not approved|protected customer data|Order object/i.test(
      errText,
    );

  if (!res.ok) {
    console.log(
      JSON.stringify({
        RESULT: "http_error",
        status: res.status,
        errors: (json.errors ?? []).map((e) => e.message.slice(0, 200)),
      }),
    );
    process.exit(1);
  }

  if (denied || json.errors?.length) {
    console.log(
      JSON.stringify(
        {
          RESULT: denied ? "pcd_denied" : "graphql_error",
          errors: (json.errors ?? []).map((e) => e.message.slice(0, 240)),
        },
        null,
        2,
      ),
    );
    process.exit(denied ? 2 : 1);
  }

  const nodes = json.data?.orders?.nodes ?? [];
  console.log(
    JSON.stringify(
      {
        RESULT: "pcd_ok",
        orders_returned: nodes.length,
        sample: nodes.map((n) => ({
          name: n.name,
          processedAt: n.processedAt,
          total: n.totalPriceSet?.shopMoney?.amount ?? null,
          line_items: n.lineItems?.nodes?.length ?? 0,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("RESULT: probe_failed", err instanceof Error ? err.message : err);
  process.exit(1);
});
