/**
 * Phase 3 in-lane agents (Operations / Supplier / Procurement).
 * Composed from synced PO, scorecard, pricing, and inventory data only —
 * no Orders API, no sales velocity, never auto-sends a PO.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase.server";
import { createPurchaseOrder } from "./purchase-orders.server";

export const SCORECARD_MIN_COMPLETED_POS = 5;
/** Workspace-level gate: enough closed history to speak in insights. */
export const WORKSPACE_INSIGHT_MIN_CLOSED_POS = 5;
/** Days after send with no Supplier Link view. */
const UNOPENED_DAYS = 2;
/** Days after view with no confirm. */
const UNCONFIRMED_DAYS = 2;
/** Default on-hand threshold when inventory_low rule has no value. */
const DEFAULT_LOW_STOCK = 5;

export type AgentName = "operations" | "supplier" | "procurement";

export type InsightType =
  | "daily_digest"
  | "po_unopened"
  | "po_unconfirmed"
  | "shipment_late"
  | "alternate_supplier"
  | "price_increase"
  | "draft_po_suggestion";

export type AiInsightRow = {
  id: string;
  agent: AgentName;
  insight_type: InsightType;
  supplier_id: string | null;
  po_id: string | null;
  summary: string;
  body: string | null;
  supporting_data: Record<string, unknown>;
  generated_at: string;
  dismissed: boolean;
};

export type AgentRunResult = {
  workspaceId: string;
  workspaceName: string;
  eligible: boolean;
  reason?: string;
  insightsCreated: number;
  digest?: {
    subject: string;
    body: string;
    emailedTo: string[];
    emailSent: boolean;
    emailError?: string;
  };
  insightIds: string[];
};

type PoLite = {
  id: string;
  po_number: string;
  status: string;
  supplier_id: string;
  updated_at: string;
  requested_ship_date: string | null;
  confirmed_ship_date: string | null;
  estimated_arrival_date: string | null;
  suppliers: { name: string } | null;
};

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function supplierName(po: PoLite) {
  return po.suppliers?.name ?? "Supplier";
}

async function insertInsight(
  supabase: SupabaseClient,
  row: {
    workspace_id: string;
    agent: AgentName;
    insight_type: InsightType;
    supplier_id?: string | null;
    po_id?: string | null;
    summary: string;
    body?: string | null;
    supporting_data?: Record<string, unknown>;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("ai_insights")
    .insert({
      workspace_id: row.workspace_id,
      agent: row.agent,
      insight_type: row.insight_type,
      supplier_id: row.supplier_id ?? null,
      po_id: row.po_id ?? null,
      summary: row.summary,
      body: row.body ?? null,
      supporting_data: row.supporting_data ?? {},
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function hasRecentInsight(
  supabase: SupabaseClient,
  workspaceId: string,
  insightType: InsightType,
  opts?: { poId?: string; supplierId?: string; withinHours?: number },
) {
  const since = new Date(
    Date.now() - (opts?.withinHours ?? 20) * 60 * 60 * 1000,
  ).toISOString();
  let q = supabase
    .from("ai_insights")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("insight_type", insightType)
    .eq("dismissed", false)
    .gte("generated_at", since)
    .limit(1);
  if (opts?.poId) q = q.eq("po_id", opts.poId);
  if (opts?.supplierId) q = q.eq("supplier_id", opts.supplierId);
  const { data } = await q.maybeSingle();
  return Boolean(data?.id);
}

export async function workspaceIsInsightEligible(
  workspaceId: string,
  supabase = createServiceClient(),
): Promise<{
  eligible: boolean;
  isDemo: boolean;
  closedCount: number;
  name: string;
  reason?: string;
}> {
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, name, is_demo")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!workspace) {
    return {
      eligible: false,
      isDemo: false,
      closedCount: 0,
      name: "Unknown",
      reason: "Workspace not found",
    };
  }

  const { count, error: countErr } = await supabase
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "closed");
  if (countErr) throw new Error(countErr.message);

  const closedCount = count ?? 0;
  const isDemo = Boolean(workspace.is_demo);
  const eligible = isDemo || closedCount >= WORKSPACE_INSIGHT_MIN_CLOSED_POS;

  return {
    eligible,
    isDemo,
    closedCount,
    name: workspace.name,
    reason: eligible
      ? undefined
      : `Need at least ${WORKSPACE_INSIGHT_MIN_CLOSED_POS} closed POs (have ${closedCount}).`,
  };
}

async function loadQueueCounts(supabase: SupabaseClient, workspaceId: string) {
  const today = todayUTC();
  const [waiting, arriving, ready, overdue] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, supplier_id, suppliers(name)")
      .eq("workspace_id", workspaceId)
      .in("status", ["sent", "viewed"]),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, suppliers(name)")
      .eq("workspace_id", workspaceId)
      .or(
        `confirmed_ship_date.eq.${today},requested_ship_date.eq.${today}`,
      )
      .in("status", ["confirmed", "production", "shipped", "in_transit"]),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, suppliers(name)")
      .eq("workspace_id", workspaceId)
      .in("status", ["shipped", "in_transit", "partially_received"]),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, suppliers(name)")
      .eq("workspace_id", workspaceId)
      .in("status", ["sent", "viewed", "confirmed", "production"])
      .lt("requested_ship_date", today),
  ]);

  for (const res of [waiting, arriving, ready, overdue]) {
    if (res.error) throw new Error(res.error.message);
  }

  return {
    waiting: (waiting.data ?? []) as PoLite[],
    arriving: (arriving.data ?? []) as PoLite[],
    ready: (ready.data ?? []) as PoLite[],
    overdue: (overdue.data ?? []) as PoLite[],
  };
}

async function countLowStockSkus(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { data: rule } = await supabase
    .from("notification_rules")
    .select("threshold_value")
    .eq("workspace_id", workspaceId)
    .eq("rule_type", "inventory_low")
    .maybeSingle();
  const threshold =
    rule?.threshold_value != null && Number(rule.threshold_value) > 0
      ? Number(rule.threshold_value)
      : DEFAULT_LOW_STOCK;

  const { data: levels, error } = await supabase
    .from("inventory_levels")
    .select("on_hand, product_variant_id")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  const byVariant = new Map<string, number>();
  for (const row of levels ?? []) {
    const id = row.product_variant_id as string;
    byVariant.set(id, (byVariant.get(id) ?? 0) + Number(row.on_hand ?? 0));
  }

  let low = 0;
  for (const onHand of byVariant.values()) {
    if (onHand <= threshold) low += 1;
  }
  return low;
}

function composeDigest(opts: {
  workspaceName: string;
  greetingName: string;
  waiting: PoLite[];
  arriving: PoLite[];
  ready: PoLite[];
  overdue: PoLite[];
  lowStockCount: number;
}): { subject: string; summary: string; body: string } {
  const { greetingName, waiting, arriving, ready, overdue, lowStockCount } =
    opts;
  const unackedSuppliers = new Set(
    waiting.map((p) => supplierName(p)),
  ).size;

  const beats: string[] = [];
  if (lowStockCount > 0) {
    beats.push(
      `${lowStockCount} product${lowStockCount === 1 ? "" : "s"} ${lowStockCount === 1 ? "is" : "are"} at or below the reorder threshold`,
    );
  }
  if (waiting.length > 0) {
    beats.push(
      `${unackedSuppliers} supplier${unackedSuppliers === 1 ? "" : "s"} ${unackedSuppliers === 1 ? "hasn't" : "haven't"} acknowledged open POs (${waiting.length} waiting)`,
    );
  }
  if (overdue.length > 0) {
    beats.push(
      `${overdue.length} PO${overdue.length === 1 ? "" : "s"} past requested ship date`,
    );
  }
  if (arriving.length > 0) {
    beats.push(
      `${arriving.length} shipment${arriving.length === 1 ? "" : "s"} scheduled for today`,
    );
  }
  if (ready.length > 0) {
    beats.push(
      `${ready.length} PO${ready.length === 1 ? "" : "s"} ready to receive`,
    );
  }

  const summary =
    beats.length > 0
      ? `Good morning, ${greetingName}. ${beats.slice(0, 3).join(". ")}.`
      : `Good morning, ${greetingName}. No PO queues need attention today — you're clear.`;

  const lines: string[] = [
    summary,
    "",
    "Today's Work",
    `• Waiting confirmation: ${waiting.length}`,
    `• Overdue (past requested ship): ${overdue.length}`,
    `• Arriving today: ${arriving.length}`,
    `• Ready to receive: ${ready.length}`,
    `• Low-stock SKUs (on-hand ≤ threshold): ${lowStockCount}`,
    "",
  ];

  if (waiting.length) {
    lines.push("Waiting confirmation:");
    for (const po of waiting.slice(0, 5)) {
      lines.push(`  - ${po.po_number} · ${supplierName(po)} (${po.status})`);
    }
    lines.push("");
  }
  if (overdue.length) {
    lines.push("Overdue:");
    for (const po of overdue.slice(0, 5)) {
      lines.push(`  - ${po.po_number} · ${supplierName(po)}`);
    }
    lines.push("");
  }
  if (ready.length) {
    lines.push("Ready to receive:");
    for (const po of ready.slice(0, 5)) {
      lines.push(`  - ${po.po_number} · ${supplierName(po)}`);
    }
    lines.push("");
  }

  lines.push(
    "Open Requisly in Shopify Admin → Today's Work to act on these items.",
    "",
    "— Requisly Operations Agent",
  );

  return {
    subject: `Requisly digest — ${opts.workspaceName}`,
    summary,
    body: lines.join("\n"),
  };
}

async function resolveDigestRecipients(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");

  const emails: string[] = [];
  for (const owner of owners ?? []) {
    try {
      const { data } = await supabase.auth.admin.getUserById(owner.id);
      if (data.user?.email) emails.push(data.user.email);
    } catch {
      /* ignore */
    }
  }

  const fallback = process.env.AI_DIGEST_FALLBACK_EMAIL?.trim();
  if (!emails.length && fallback) emails.push(fallback);
  return emails;
}

async function sendDigestEmail(opts: {
  to: string[];
  subject: string;
  body: string;
}): Promise<{ sent: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL || "Requisly <notifications@requisly.app>";
  if (!resendKey) {
    return { sent: false, error: "RESEND_API_KEY is not set" };
  }
  if (!opts.to.length) {
    return { sent: false, error: "No recipient emails" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        text: opts.body,
      }),
    });
    if (!response.ok) {
      return { sent: false, error: await response.text() };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

/** Operations Agent — daily digest. */
export async function runOperationsAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<{
  insightId: string | null;
  digest: NonNullable<AgentRunResult["digest"]>;
}> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) {
    throw new Error(gate.reason ?? "Workspace not eligible");
  }

  if (!opts?.force && (await hasRecentInsight(supabase, workspaceId, "daily_digest", { withinHours: 20 }))) {
    const { data: existing } = await supabase
      .from("ai_insights")
      .select("id, summary, body, supporting_data")
      .eq("workspace_id", workspaceId)
      .eq("insight_type", "daily_digest")
      .eq("dismissed", false)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const support = (existing?.supporting_data ?? {}) as {
      subject?: string;
      emailedTo?: string[];
    };
    return {
      insightId: existing?.id ?? null,
      digest: {
        subject: support.subject ?? `Requisly digest — ${gate.name}`,
        body: existing?.body ?? existing?.summary ?? "",
        emailedTo: support.emailedTo ?? [],
        emailSent: false,
        emailError: "Skipped — digest already generated in the last 20h",
      },
    };
  }

  const queues = await loadQueueCounts(supabase, workspaceId);
  const lowStockCount = await countLowStockSkus(supabase, workspaceId);
  const recipients = await resolveDigestRecipients(supabase, workspaceId);
  const greetingName =
    gate.name.replace(/\s+Goods$/i, "").split(/\s+/)[0] || gate.name;

  const composed = composeDigest({
    workspaceName: gate.name,
    greetingName,
    waiting: queues.waiting,
    arriving: queues.arriving,
    ready: queues.ready,
    overdue: queues.overdue,
    lowStockCount,
  });

  const email = await sendDigestEmail({
    to: recipients,
    subject: composed.subject,
    body: composed.body,
  });

  if (email.sent) {
    for (const emailAddr of recipients) {
      await supabase.from("notification_log").insert({
        workspace_id: workspaceId,
        rule_type: "daily_digest",
        po_id: null,
        recipient_email: emailAddr,
      });
    }
  }

  const insightId = await insertInsight(supabase, {
    workspace_id: workspaceId,
    agent: "operations",
    insight_type: "daily_digest",
    summary: composed.summary,
    body: composed.body,
    supporting_data: {
      subject: composed.subject,
      counts: {
        waiting: queues.waiting.length,
        overdue: queues.overdue.length,
        arriving: queues.arriving.length,
        ready: queues.ready.length,
        lowStock: lowStockCount,
      },
      emailedTo: recipients,
      emailSent: email.sent,
      emailError: email.error ?? null,
    },
  });

  return {
    insightId,
    digest: {
      subject: composed.subject,
      body: composed.body,
      emailedTo: recipients,
      emailSent: email.sent,
      emailError: email.error,
    },
  };
}

/** Supplier Agent — timeline + scorecard insights. */
export async function runSupplierAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) return [];

  const ids: string[] = [];
  const unopenedCutoff = daysAgoISO(UNOPENED_DAYS);
  const unconfirmedCutoff = daysAgoISO(UNCONFIRMED_DAYS);
  const today = todayUTC();

  // Sent but never viewed (still status=sent, old enough).
  const { data: unopened, error: uErr } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, supplier_id, updated_at, suppliers(name)",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "sent")
    .lt("updated_at", unopenedCutoff)
    .limit(20);
  if (uErr) throw new Error(uErr.message);

  for (const po of (unopened ?? []) as PoLite[]) {
    if (
      !opts?.force &&
      (await hasRecentInsight(supabase, workspaceId, "po_unopened", {
        poId: po.id,
        withinHours: 48,
      }))
    ) {
      continue;
    }
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "po_unopened",
        supplier_id: po.supplier_id,
        po_id: po.id,
        summary: `${po.po_number} was sent to ${supplierName(po)} but hasn't been opened on Supplier Link after ${UNOPENED_DAYS}+ days.`,
        supporting_data: { days: UNOPENED_DAYS, status: po.status },
      }),
    );
  }

  // Viewed but not confirmed.
  const { data: unconfirmed, error: cErr } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, supplier_id, updated_at, suppliers(name)",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "viewed")
    .lt("updated_at", unconfirmedCutoff)
    .limit(20);
  if (cErr) throw new Error(cErr.message);

  for (const po of (unconfirmed ?? []) as PoLite[]) {
    if (
      !opts?.force &&
      (await hasRecentInsight(supabase, workspaceId, "po_unconfirmed", {
        poId: po.id,
        withinHours: 48,
      }))
    ) {
      continue;
    }
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "po_unconfirmed",
        supplier_id: po.supplier_id,
        po_id: po.id,
        summary: `${supplierName(po)} viewed ${po.po_number} but hasn't confirmed after ${UNCONFIRMED_DAYS}+ days.`,
        supporting_data: { days: UNCONFIRMED_DAYS, status: po.status },
      }),
    );
  }

  // Shipped past estimated arrival with no further update.
  const { data: lateShip, error: lErr } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, supplier_id, estimated_arrival_date, suppliers(name)",
    )
    .eq("workspace_id", workspaceId)
    .in("status", ["shipped", "in_transit"])
    .lt("estimated_arrival_date", today)
    .limit(20);
  if (lErr) throw new Error(lErr.message);

  for (const po of (lateShip ?? []) as PoLite[]) {
    if (
      !opts?.force &&
      (await hasRecentInsight(supabase, workspaceId, "shipment_late", {
        poId: po.id,
        withinHours: 48,
      }))
    ) {
      continue;
    }
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "shipment_late",
        supplier_id: po.supplier_id,
        po_id: po.id,
        summary: `${po.po_number} from ${supplierName(po)} is past its estimated arrival (${po.estimated_arrival_date}) with no receiving update.`,
        supporting_data: {
          estimated_arrival_date: po.estimated_arrival_date,
          status: po.status,
        },
      }),
    );
  }

  // Alternate supplier when scorecard shows lateness pattern (5+ closed).
  const { data: scorecards, error: sErr } = await supabase
    .from("supplier_scorecards")
    .select("supplier_id, completed_pos, on_time_pct")
    .eq("workspace_id", workspaceId);
  if (sErr) throw new Error(sErr.message);

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  const nameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  for (const row of scorecards ?? []) {
    const completed = Number(row.completed_pos ?? 0);
    const onTime = Number(row.on_time_pct);
    if (completed < SCORECARD_MIN_COMPLETED_POS) continue;
    if (Number.isNaN(onTime) || onTime >= 0.7) continue;

    const supplierId = row.supplier_id as string;
    if (
      !opts?.force &&
      (await hasRecentInsight(supabase, workspaceId, "alternate_supplier", {
        supplierId,
        withinHours: 168,
      }))
    ) {
      continue;
    }

    const latePct = Math.round((1 - onTime) * 100);
    const alt = (scorecards ?? []).find(
      (other) =>
        other.supplier_id !== supplierId &&
        Number(other.completed_pos ?? 0) >= SCORECARD_MIN_COMPLETED_POS &&
        Number(other.on_time_pct) > onTime,
    );
    const altName = alt ? nameById.get(alt.supplier_id) : null;
    const summary = altName
      ? `${nameById.get(supplierId) ?? "Supplier"} has been late on roughly ${latePct}% of closed orders (${completed} completed). Consider ${altName} as an alternate — their on-time rate is stronger on the same history threshold.`
      : `${nameById.get(supplierId) ?? "Supplier"} has been late on roughly ${latePct}% of closed orders (${completed} completed). Review alternate suppliers before the next reorder.`;

    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "alternate_supplier",
        supplier_id: supplierId,
        summary,
        supporting_data: {
          completed_pos: completed,
          on_time_pct: onTime,
          alternate_supplier_id: alt?.supplier_id ?? null,
        },
      }),
    );
  }

  return ids;
}

/** Procurement Agent — price increases + draft PO suggestions (never auto-send). */
export async function runProcurementAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) return [];

  const ids: string[] = [];
  const today = todayUTC();

  // (a) Upcoming / recent price increases from supplier_product_prices.
  const { data: products, error: pErr } = await supabase
    .from("supplier_products")
    .select("id, title, sku, supplier_id, suppliers(name)")
    .eq("workspace_id", workspaceId);
  if (pErr) throw new Error(pErr.message);

  for (const sp of products ?? []) {
    const { data: prices, error: priceErr } = await supabase
      .from("supplier_product_prices")
      .select("unit_cost, effective_date")
      .eq("supplier_product_id", sp.id)
      .order("effective_date", { ascending: true });
    if (priceErr) throw new Error(priceErr.message);
    if (!prices || prices.length < 2) continue;

    const current = [...prices]
      .filter((p) => p.effective_date <= today)
      .pop();
    const next = prices.find((p) => p.effective_date > today);
    const prior = [...prices]
      .filter((p) => p.effective_date < (current?.effective_date ?? today))
      .pop();

    // Flag scheduled increases, or recent increases vs prior tier.
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
      Number(current.unit_cost) > Number(prior.unit_cost) &&
      current.effective_date >= daysAgoISO(30).slice(0, 10)
    ) {
      fromCost = Number(prior.unit_cost);
      toCost = Number(current.unit_cost);
      effective = current.effective_date;
    } else {
      continue;
    }

    if (
      !opts?.force &&
      (await hasRecentInsight(supabase, workspaceId, "price_increase", {
        supplierId: sp.supplier_id,
        withinHours: 168,
      }))
    ) {
      // Allow multiple products — key by supporting title in dedupe loosely:
      const { data: dup } = await supabase
        .from("ai_insights")
        .select("id, supporting_data")
        .eq("workspace_id", workspaceId)
        .eq("insight_type", "price_increase")
        .eq("dismissed", false)
        .gte("generated_at", daysAgoISO(7))
        .limit(20);
      const already = (dup ?? []).some(
        (row) =>
          (row.supporting_data as { supplier_product_id?: string })
            ?.supplier_product_id === sp.id,
      );
      if (already) continue;
    }

    const supplierLabel =
      (sp.suppliers as { name: string } | null)?.name ?? "Supplier";
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "procurement",
        insight_type: "price_increase",
        supplier_id: sp.supplier_id,
        summary: `${supplierLabel} raised ${sp.title} from $${fromCost.toFixed(2)} to $${toCost.toFixed(2)} effective ${effective}.`,
        supporting_data: {
          supplier_product_id: sp.id,
          sku: sp.sku,
          from_unit_cost: fromCost,
          to_unit_cost: toCost,
          effective_date: effective,
        },
      }),
    );
  }

  // (b) Low-stock → draft PO with cheapest confirmed supplier product.
  const { data: rule } = await supabase
    .from("notification_rules")
    .select("threshold_value")
    .eq("workspace_id", workspaceId)
    .eq("rule_type", "inventory_low")
    .maybeSingle();
  const threshold =
    rule?.threshold_value != null && Number(rule.threshold_value) > 0
      ? Number(rule.threshold_value)
      : DEFAULT_LOW_STOCK;

  const { data: levels } = await supabase
    .from("inventory_levels")
    .select("on_hand, product_variant_id, location_id")
    .eq("workspace_id", workspaceId);

  const onHandByVariant = new Map<string, { onHand: number; locationId: string }>();
  for (const row of levels ?? []) {
    const id = row.product_variant_id as string;
    const onHand = Number(row.on_hand ?? 0);
    const prev = onHandByVariant.get(id);
    if (!prev || onHand < prev.onHand) {
      onHandByVariant.set(id, {
        onHand,
        locationId: row.location_id as string,
      });
    }
  }

  const lowVariants = [...onHandByVariant.entries()]
    .filter(([, v]) => v.onHand <= threshold)
    .slice(0, 5);

  if (lowVariants.length) {
    if (
      opts?.force ||
      !(await hasRecentInsight(supabase, workspaceId, "draft_po_suggestion", {
        withinHours: 48,
      }))
    ) {
      // Pick cheapest supplier_product among linked variants.
      const variantIds = lowVariants.map(([id]) => id);
      const { data: catalog } = await supabase
        .from("product_variants")
        .select("id, title, sku")
        .eq("workspace_id", workspaceId)
        .in("id", variantIds);

      const { data: linked } = await supabase
        .from("supplier_products")
        .select(
          "id, title, sku, supplier_id, product_variant_id, case_qty, suppliers(name)",
        )
        .eq("workspace_id", workspaceId)
        .in("product_variant_id", variantIds);

      type LinePick = {
        description: string;
        sku: string;
        qty: number;
        unit_cost: number;
        supplier_product_id: string;
        supplier_id: string;
        supplier_name: string;
        product_variant_id: string;
      };

      const picks: LinePick[] = [];
      for (const variant of catalog ?? []) {
        const candidates = (linked ?? []).filter(
          (sp) => sp.product_variant_id === variant.id,
        );
        let best: LinePick | null = null;
        for (const sp of candidates) {
          const { data: priceRows } = await supabase
            .from("supplier_product_prices")
            .select("unit_cost, effective_date")
            .eq("supplier_product_id", sp.id)
            .lte("effective_date", today)
            .order("effective_date", { ascending: false })
            .limit(1);
          const unit = Number(priceRows?.[0]?.unit_cost);
          if (!Number.isFinite(unit)) continue;
          const onHand = onHandByVariant.get(variant.id)?.onHand ?? 0;
          const caseQty = Number(sp.case_qty) > 0 ? Number(sp.case_qty) : 1;
          const qty = Math.max(caseQty, threshold * 2 - onHand);
          const pick: LinePick = {
            description: sp.title || variant.title,
            sku: sp.sku || variant.sku || "",
            qty,
            unit_cost: unit,
            supplier_product_id: sp.id,
            supplier_id: sp.supplier_id,
            supplier_name:
              (sp.suppliers as { name: string } | null)?.name ?? "Supplier",
            product_variant_id: variant.id,
          };
          if (!best || pick.unit_cost < best.unit_cost) best = pick;
        }
        if (best) picks.push(best);
      }

      if (picks.length) {
        // Group by cheapest-majority supplier for one draft PO.
        const bySupplier = new Map<string, LinePick[]>();
        for (const pick of picks) {
          const list = bySupplier.get(pick.supplier_id) ?? [];
          list.push(pick);
          bySupplier.set(pick.supplier_id, list);
        }
        let chosenSupplier = "";
        let chosenLines: LinePick[] = [];
        for (const [sid, lines] of bySupplier) {
          if (lines.length > chosenLines.length) {
            chosenSupplier = sid;
            chosenLines = lines;
          }
        }

        const locationId =
          onHandByVariant.get(chosenLines[0].product_variant_id)?.locationId ??
          null;

        const created = await createPurchaseOrder({
          workspaceId,
          supplierId: chosenSupplier,
          locationId,
          requestedShipDate: null,
          notes:
            "AI-suggested draft from low on-hand levels. Review quantities and pricing before sending — never auto-sent.",
          lines: chosenLines.map((l) => ({
            description: l.description,
            sku: l.sku,
            qty: l.qty,
            unit_cost: l.unit_cost,
            is_free_text: false,
            supplier_product_id: l.supplier_product_id,
          })),
          source: "ai_procurement_agent",
        });

        ids.push(
          await insertInsight(supabase, {
            workspace_id: workspaceId,
            agent: "procurement",
            insight_type: "draft_po_suggestion",
            supplier_id: chosenSupplier,
            po_id: created.id,
            summary: `Draft ${created.poNumber} suggested for ${chosenLines.length} low-stock SKU${chosenLines.length === 1 ? "" : "s"} via ${chosenLines[0].supplier_name} (cheapest confirmed unit cost). Review before sending — not sent.`,
            body: chosenLines
              .map(
                (l) =>
                  `${l.description} × ${l.qty} @ $${l.unit_cost.toFixed(2)}`,
              )
              .join("\n"),
            supporting_data: {
              po_id: created.id,
              po_number: created.poNumber,
              threshold,
              lines: chosenLines,
              ai_suggested: true,
              auto_sent: false,
            },
          }),
        );
      }
    }
  }

  return ids;
}

/** Run all three agents for one workspace. */
export async function runAllAgentsForWorkspace(
  workspaceId: string,
  opts?: { force?: boolean },
): Promise<AgentRunResult> {
  const supabase = createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) {
    return {
      workspaceId,
      workspaceName: gate.name,
      eligible: false,
      reason: gate.reason,
      insightsCreated: 0,
      insightIds: [],
    };
  }

  const ops = await runOperationsAgent(workspaceId, {
    force: opts?.force,
    supabase,
  });
  const supplierIds = await runSupplierAgent(workspaceId, {
    force: opts?.force,
    supabase,
  });
  const procurementIds = await runProcurementAgent(workspaceId, {
    force: opts?.force,
    supabase,
  });

  const insightIds = [
    ...(ops.insightId ? [ops.insightId] : []),
    ...supplierIds,
    ...procurementIds,
  ];

  return {
    workspaceId,
    workspaceName: gate.name,
    eligible: true,
    insightsCreated: insightIds.length,
    digest: ops.digest,
    insightIds,
  };
}

/** Cron/Edge entry — all eligible workspaces. */
export async function runAllAgentsForEligibleWorkspaces(opts?: {
  force?: boolean;
  workspaceId?: string;
}): Promise<AgentRunResult[]> {
  const supabase = createServiceClient();
  let q = supabase.from("workspaces").select("id, name, is_demo");
  if (opts?.workspaceId) q = q.eq("id", opts.workspaceId);
  const { data: workspaces, error } = await q;
  if (error) throw new Error(error.message);

  const results: AgentRunResult[] = [];
  for (const ws of workspaces ?? []) {
    results.push(
      await runAllAgentsForWorkspace(ws.id, { force: opts?.force }),
    );
  }
  return results;
}

export async function listActiveInsights(
  workspaceId: string,
  limit = 20,
): Promise<AiInsightRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .select(
      "id, agent, insight_type, supplier_id, po_id, summary, body, supporting_data, generated_at, dismissed",
    )
    .eq("workspace_id", workspaceId)
    .eq("dismissed", false)
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AiInsightRow[];
}

export async function dismissInsight(
  workspaceId: string,
  insightId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ai_insights")
    .update({ dismissed: true })
    .eq("id", insightId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}
