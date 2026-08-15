/**
 * Place synthetic Bogus/test orders on Salt & Fern (requisly.myshopify.com).
 *
 * THESE ARE SYNTHETIC TEST ORDERS — not real customer commerce.
 * Do not conflate with Salt & Fern's real PO/supplier seed data (is_demo=false).
 * Tagged: requisly_synthetic_test
 * Note prefix: [REQUISLY_SYNTHETIC_TEST]
 *
 *   npx tsx scripts/place-salt-fern-synthetic-orders.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHOP = "requisly.myshopify.com";
const EMBEDDED = resolve(process.cwd(), "embedded");
const TMP = resolve(process.cwd(), "tmp");
const QUERY = resolve(TMP, "order-create-nouser.graphql");
const TAG = "requisly_synthetic_test";
const NOTE =
  "[REQUISLY_SYNTHETIC_TEST] Synthetic Bogus/test order for Orders-sync + velocity plumbing QA. NOT real customer demand.";

/** Active variants with inventory — diversified across products. */
const VARIANTS = {
  completeIce: "gid://shopify/ProductVariant/49159885422827",
  completeDawn: "gid://shopify/ProductVariant/49159885455595",
  completePowder: "gid://shopify/ProductVariant/49159885488363",
  compareAt: "gid://shopify/ProductVariant/49159885848811",
  collectionHydrogen: "gid://shopify/ProductVariant/49159885390059",
  minimal: "gid://shopify/ProductVariant/49159885783275",
  skiWax: "gid://shopify/ProductVariant/49159885291755",
} as const;

type Plan = {
  processedAt: string;
  lines: Array<{ variantId: string; quantity: number; price: string }>;
};

/** Spread over ~3 weeks ending 2026-08-14 (today in workspace). */
const PLANS: Plan[] = [
  {
    processedAt: "2026-07-25T15:22:00Z",
    lines: [
      { variantId: VARIANTS.completeIce, quantity: 1, price: "699.95" },
      { variantId: VARIANTS.skiWax, quantity: 2, price: "24.95" },
    ],
  },
  {
    processedAt: "2026-07-28T18:05:00Z",
    lines: [
      { variantId: VARIANTS.compareAt, quantity: 1, price: "785.95" },
    ],
  },
  {
    processedAt: "2026-08-01T14:40:00Z",
    lines: [
      { variantId: VARIANTS.completeDawn, quantity: 2, price: "699.95" },
    ],
  },
  {
    processedAt: "2026-08-03T20:11:00Z",
    lines: [
      { variantId: VARIANTS.minimal, quantity: 1, price: "885.95" },
      { variantId: VARIANTS.skiWax, quantity: 1, price: "24.95" },
    ],
  },
  {
    processedAt: "2026-08-06T16:33:00Z",
    lines: [
      { variantId: VARIANTS.collectionHydrogen, quantity: 1, price: "600.00" },
    ],
  },
  {
    processedAt: "2026-08-09T12:18:00Z",
    lines: [
      { variantId: VARIANTS.completePowder, quantity: 1, price: "699.95" },
      { variantId: VARIANTS.compareAt, quantity: 1, price: "785.95" },
    ],
  },
  {
    processedAt: "2026-08-11T19:47:00Z",
    lines: [
      { variantId: VARIANTS.completeIce, quantity: 1, price: "699.95" },
    ],
  },
  {
    processedAt: "2026-08-13T21:05:00Z",
    lines: [
      { variantId: VARIANTS.completeDawn, quantity: 1, price: "699.95" },
      { variantId: VARIANTS.skiWax, quantity: 3, price: "24.95" },
    ],
  },
];

function lineTotal(plan: Plan): number {
  return plan.lines.reduce(
    (sum, l) => sum + Number(l.price) * l.quantity,
    0,
  );
}

function storeExecute(variableFile: string, outputFile: string) {
  // App offline token required for orderCreate (store auth is online-only).
  // Response omits `order { ... }` — app lacks Protected Customer Data approval,
  // so selecting Order fields returns ACCESS_DENIED even when create succeeds.
  try {
    execFileSync(
      "npx",
      [
        "shopify",
        "app",
        "execute",
        "-s",
        SHOP,
        "--query-file",
        QUERY,
        "--variable-file",
        variableFile,
        "--output-file",
        outputFile,
      ],
      { cwd: EMBEDDED, encoding: "utf8", shell: true, stdio: "pipe" },
    );
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`;
    if (!existsSync(outputFile)) {
      throw new Error(`orderCreate CLI failed with no output: ${detail.slice(0, 800)}`);
    }
    console.warn("CLI reported error but wrote output — inspecting userErrors");
  }
  return JSON.parse(readFileSync(outputFile, "utf8")) as {
    orderCreate?: {
      userErrors?: Array<{ field?: string[]; message: string }>;
      order?: {
        id: string;
        name: string;
        test: boolean;
        processedAt: string;
        tags: string[];
        note: string | null;
        displayFinancialStatus: string;
        totalPriceSet?: { shopMoney?: { amount?: string } };
      };
    };
  };
}

function main() {
  mkdirSync(TMP, { recursive: true });
  console.log("=== SYNTHETIC TEST ORDERS (not real customer demand) ===");
  console.log("shop:", SHOP);
  console.log("tag:", TAG);
  console.log("count:", PLANS.length);

  const created: Array<Record<string, unknown>> = [];

  PLANS.forEach((plan, i) => {
    const amount = lineTotal(plan).toFixed(2);
    const vars = {
      options: {
        inventoryBehaviour: "DECREMENT_IGNORING_POLICY",
        sendReceipt: false,
        sendFulfillmentReceipt: false,
      },
      order: {
        test: true,
        processedAt: plan.processedAt,
        tags: [TAG, "bogus_gateway_sim"],
        note: `${NOTE} plan_index=${i} processedAt=${plan.processedAt}`,
        financialStatus: "PAID",
        lineItems: plan.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          priceSet: {
            shopMoney: { amount: l.price, currencyCode: "USD" },
          },
        })),
        transactions: [
          {
            kind: "SALE",
            status: "SUCCESS",
            test: true,
            amountSet: {
              shopMoney: { amount, currencyCode: "USD" },
            },
          },
        ],
      },
    };

    const varFile = resolve(TMP, `synthetic-order-${i}.vars.json`);
    const outFile = resolve(TMP, `synthetic-order-${i}.out.json`);
    writeFileSync(varFile, JSON.stringify(vars, null, 2));

    const result = storeExecute(varFile, outFile);
    const errors = result.orderCreate?.userErrors ?? [];
    if (errors.length) {
      console.error(`FAIL plan_${i}:`, errors);
      throw new Error(errors.map((e) => e.message).join("; "));
    }
    // Order payload omitted (PCD) — success = empty userErrors.
    console.log(
      `created plan_${i} processedAt=${plan.processedAt} lines=${plan.lines.length} (synthetic; Order fields not readable without PCD)`,
    );
    created.push({
      planIndex: i,
      processedAt: plan.processedAt,
      lineCount: plan.lines.length,
      synthetic: true,
    });
  });

  writeFileSync(
    resolve(TMP, "synthetic-orders-created.json"),
    JSON.stringify(
      {
        kind: "SYNTHETIC_TEST_ORDERS",
        warning:
          "Confirms mechanism only — NOT real customer-driven velocity. Do not conflate with real PO/supplier seed.",
        shop: SHOP,
        tag: TAG,
        createdAt: new Date().toISOString(),
        orders: created,
      },
      null,
      2,
    ),
  );
  console.log("Wrote tmp/synthetic-orders-created.json");
  console.log("DONE", created.length);
}

main();
