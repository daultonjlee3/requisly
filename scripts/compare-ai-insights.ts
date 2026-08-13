/**
 * Side-by-side: deterministic template vs Claude Haiku narration for real scenarios.
 *
 *   npx tsx --env-file=embedded/.env scripts/compare-ai-insights.ts
 *
 * Does not insert insights or create draft POs — narration only.
 */
import { createClient } from "@supabase/supabase-js";

const DEMO_ID = "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

function printPair(label: string, template: string, claude: {
  summary: string;
  source: string;
  error?: string;
}) {
  console.log(`\n========== ${label} ==========`);
  console.log("--- TEMPLATE ---");
  console.log(template);
  console.log("--- CLAUDE ---");
  console.log(claude.summary);
  console.log(`(source=${claude.source}${claude.error ? `; fallback_reason=${claude.error}` : ""})`);
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  console.log(`ANTHROPIC_API_KEY set: ${hasAnthropic}`);
  if (!hasAnthropic) {
    console.warn(
      "No ANTHROPIC_API_KEY — Claude path will fall back to templates (comparison will look identical).",
    );
  }

  const {
    narrateInsight,
  } = await import("../embedded/app/lib/ai-narration.server.ts");
  const {
    SCORECARD_MIN_COMPLETED_POS,
    templateAlternateSupplier,
    templatePoUnopened,
    templatePriceIncrease,
    templateShipmentLate,
    workspaceIsInsightEligible,
  } = await import("../embedded/app/lib/ai-agents.server.ts");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const gate = await workspaceIsInsightEligible(DEMO_ID, supabase);
  console.log(
    `Workspace: ${gate.name} eligible=${gate.eligible} demo=${gate.isDemo} closed=${gate.closedCount}`,
  );
  if (!gate.eligible) {
    throw new Error(gate.reason ?? "Demo workspace not eligible");
  }

  // --- Scenario: late supplier pattern (scorecard) ---
  const { data: scorecards } = await supabase
    .from("supplier_scorecards")
    .select("supplier_id, completed_pos, on_time_pct")
    .eq("workspace_id", DEMO_ID);
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", DEMO_ID);
  const nameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const late = (scorecards ?? [])
    .map((row) => ({
      supplier_id: row.supplier_id as string,
      completed: Number(row.completed_pos ?? 0),
      onTime: Number(row.on_time_pct),
    }))
    .filter(
      (r) =>
        r.completed >= SCORECARD_MIN_COMPLETED_POS &&
        !Number.isNaN(r.onTime) &&
        r.onTime < 0.7,
    )
    .sort((a, b) => a.onTime - b.onTime)[0];

  if (late) {
    const latePct = Math.round((1 - late.onTime) * 100);
    const alt = (scorecards ?? []).find(
      (other) =>
        other.supplier_id !== late.supplier_id &&
        Number(other.completed_pos ?? 0) >= SCORECARD_MIN_COMPLETED_POS &&
        Number(other.on_time_pct) > late.onTime,
    );
    const supplierName = nameById.get(late.supplier_id) ?? "Supplier";
    const altName = alt ? nameById.get(alt.supplier_id) ?? null : null;
    const template = templateAlternateSupplier({
      supplierName,
      latePct,
      completed: late.completed,
      altName,
    });
    const claude = await narrateInsight({
      insightType: "alternate_supplier",
      facts: {
        supplier_name: supplierName,
        completed_pos: late.completed,
        on_time_pct: late.onTime,
        late_pct: latePct,
        alternate_supplier_name: altName,
        alternate_on_time_pct: alt ? Number(alt.on_time_pct) : null,
        scorecard_min_completed_pos: SCORECARD_MIN_COMPLETED_POS,
      },
      fallback: { summary: template },
    });
    printPair(`Late pattern — ${supplierName}`, template, claude);
  } else {
    console.log("\n(No late scorecard supplier ≥5 closed with on-time <70%)");
  }

  // --- Scenario: price increase ---
  const today = new Date().toISOString().slice(0, 10);
  const { data: products } = await supabase
    .from("supplier_products")
    .select("id, title, sku, supplier_id, suppliers(name)")
    .eq("workspace_id", DEMO_ID)
    .limit(40);

  let priceFound = false;
  for (const sp of products ?? []) {
    const { data: prices } = await supabase
      .from("supplier_product_prices")
      .select("unit_cost, effective_date")
      .eq("supplier_product_id", sp.id)
      .order("effective_date", { ascending: true });
    if (!prices || prices.length < 2) continue;
    const current = [...prices].filter((p) => p.effective_date <= today).pop();
    const next = prices.find((p) => p.effective_date > today);
    const prior = [...prices]
      .filter((p) => p.effective_date < (current?.effective_date ?? today))
      .pop();
    let fromCost: number | null = null;
    let toCost: number | null = null;
    let effective = "";
    if (next && current && Number(next.unit_cost) > Number(current.unit_cost)) {
      fromCost = Number(current.unit_cost);
      toCost = Number(next.unit_cost);
      effective = next.effective_date;
    } else if (
      current &&
      prior &&
      Number(current.unit_cost) > Number(prior.unit_cost)
    ) {
      fromCost = Number(prior.unit_cost);
      toCost = Number(current.unit_cost);
      effective = current.effective_date;
    } else {
      continue;
    }
    const supplierLabel =
      (sp.suppliers as { name: string } | null)?.name ?? "Supplier";
    const template = templatePriceIncrease({
      supplierLabel,
      title: sp.title,
      fromCost,
      toCost,
      effective,
    });
    const claude = await narrateInsight({
      insightType: "price_increase",
      facts: {
        supplier_name: supplierLabel,
        product_title: sp.title,
        sku: sp.sku,
        from_unit_cost: fromCost,
        to_unit_cost: toCost,
        effective_date: effective,
      },
      fallback: { summary: template },
    });
    printPair(`Price increase — ${sp.title}`, template, claude);
    priceFound = true;
    break;
  }
  if (!priceFound) console.log("\n(No price-increase tier found on demo catalog)");

  // --- Scenario: unopened PO (or synthesize facts from a sent PO) ---
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  const { data: unopened } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status, supplier_id, updated_at, suppliers(name)")
    .eq("workspace_id", DEMO_ID)
    .eq("status", "sent")
    .lt("updated_at", cutoff.toISOString())
    .limit(1);

  let unopenedPo = unopened?.[0] as
    | {
        po_number: string;
        status: string;
        suppliers: { name: string } | null;
      }
    | undefined;

  if (!unopenedPo) {
    const { data: anySent } = await supabase
      .from("purchase_orders")
      .select("id, po_number, status, suppliers(name)")
      .eq("workspace_id", DEMO_ID)
      .in("status", ["sent", "viewed", "confirmed"])
      .limit(1);
    if (anySent?.[0]) {
      unopenedPo = anySent[0] as typeof unopenedPo;
      console.log(
        "\n(No stale unopened PO — using a real PO number for narration demo)",
      );
    }
  }

  if (unopenedPo) {
    const poLite = {
      id: "compare",
      po_number: unopenedPo.po_number,
      status: "sent",
      supplier_id: "x",
      updated_at: cutoff.toISOString(),
      requested_ship_date: null,
      confirmed_ship_date: null,
      estimated_arrival_date: null,
      suppliers: unopenedPo.suppliers,
    };
    const template = templatePoUnopened(poLite);
    const claude = await narrateInsight({
      insightType: "po_unopened",
      facts: {
        po_number: poLite.po_number,
        supplier_name: poLite.suppliers?.name ?? "Supplier",
        status: "sent",
        days_unopened_threshold: 2,
      },
      fallback: { summary: template },
    });
    printPair(`Unopened PO — ${poLite.po_number}`, template, claude);
  }

  // Extra: late shipment if present
  const todayStr = today;
  const { data: lateShip } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, supplier_id, estimated_arrival_date, suppliers(name)",
    )
    .eq("workspace_id", DEMO_ID)
    .in("status", ["shipped", "in_transit"])
    .lt("estimated_arrival_date", todayStr)
    .limit(1);

  if (lateShip?.[0]) {
    const po = lateShip[0] as {
      po_number: string;
      status: string;
      estimated_arrival_date: string;
      suppliers: { name: string } | null;
    };
    const poLite = {
      id: "compare",
      po_number: po.po_number,
      status: po.status,
      supplier_id: "x",
      updated_at: todayStr,
      requested_ship_date: null,
      confirmed_ship_date: null,
      estimated_arrival_date: po.estimated_arrival_date,
      suppliers: po.suppliers,
    };
    const template = templateShipmentLate(poLite);
    const claude = await narrateInsight({
      insightType: "shipment_late",
      facts: {
        po_number: po.po_number,
        supplier_name: po.suppliers?.name ?? "Supplier",
        status: po.status,
        estimated_arrival_date: po.estimated_arrival_date,
      },
      fallback: { summary: template },
    });
    printPair(`Late shipment — ${po.po_number}`, template, claude);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
