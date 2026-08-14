/**
 * Phase 3 in-lane agents (Operations / Supplier / Procurement / Margin /
 * Quality / Reorder / Documentation / Hygiene).
 * Facts come from synced PO, scorecard, pricing, receipts, and inventory data
 * only — no Orders API, no sales velocity, never auto-sends a PO.
 *
 * Copy is narrated by Claude Haiku when ANTHROPIC_API_KEY is set; on any API
 * failure we fall back to the deterministic templates so insights still appear.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { narrateInsight } from "./ai-narration.server";
import {
  listLowStockVariants,
} from "./low-stock.server";
import { createServiceClient } from "./supabase.server";
import { createPurchaseOrder } from "./purchase-orders.server";

export const SCORECARD_MIN_COMPLETED_POS = 5;
/** Workspace-level gate: enough closed history to speak in insights. */
export const WORKSPACE_INSIGHT_MIN_CLOSED_POS = 5;
/** Days after send with no Supplier Link view. */
const UNOPENED_DAYS = 2;
/** Days after view with no confirm. */
const UNCONFIRMED_DAYS = 2;
/** Margin compression threshold (percentage points). */
const MARGIN_COMPRESSION_PP = 5;
/** Lookback window for quality pattern (recent closed POs with receipts). */
const QUALITY_LOOKBACK_POS = 8;
/** Min issue-orders in lookback to flag a quality pattern. */
const QUALITY_MIN_ISSUE_ORDERS = 3;
/** Min closed POs with order dates to detect reorder cadence. */
const REORDER_MIN_ORDERS = 4;
/** Flag when days since last order ≥ this fraction of the cadence. */
const REORDER_APPROACH_FRAC = 0.85;
/** Max relative gap deviation from median to treat as a stable cadence. */
const REORDER_GAP_CV_MAX = 0.4;
/** Min closed POs missing docs before supplier-level documentation pattern. */
const DOCS_PATTERN_MIN_POS = 3;
/** Catalog price staleness (days since last effective_date). */
const CATALOG_STALE_DAYS = 90;

export type AgentName =
  | "operations"
  | "supplier"
  | "procurement"
  | "margin"
  | "quality"
  | "reorder"
  | "documentation"
  | "hygiene"
  | "reports";

export type InsightType =
  | "daily_digest"
  | "po_unopened"
  | "po_unconfirmed"
  | "shipment_late"
  | "alternate_supplier"
  | "price_increase"
  | "draft_po_suggestion"
  | "margin_compression"
  | "quality_pattern"
  | "reorder_cadence"
  | "missing_documents"
  | "missing_documents_pattern"
  | "catalog_incomplete"
  | "catalog_price_stale"
  | "onboarding_nudge"
  | "pinned_report";

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
  const { variants } = await listLowStockVariants(supabase, workspaceId);
  return variants.length;
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

/** Deterministic template copy — also used as Claude fallback. Exported for side-by-side QA. */
export function templateDigest(opts: Parameters<typeof composeDigest>[0]) {
  return composeDigest(opts);
}

export function templatePoUnopened(po: PoLite) {
  return `${po.po_number} was sent to ${supplierName(po)} but hasn't been opened on Supplier Link after ${UNOPENED_DAYS}+ days.`;
}

export function templatePoUnconfirmed(po: PoLite) {
  return `${supplierName(po)} viewed ${po.po_number} but hasn't confirmed after ${UNCONFIRMED_DAYS}+ days.`;
}

export function templateShipmentLate(po: PoLite) {
  return `${po.po_number} from ${supplierName(po)} is past its estimated arrival (${po.estimated_arrival_date}) with no receiving update.`;
}

export function templateAlternateSupplier(opts: {
  supplierName: string;
  latePct: number;
  completed: number;
  altName: string | null;
}) {
  return opts.altName
    ? `${opts.supplierName} has been late on roughly ${opts.latePct}% of closed orders (${opts.completed} completed). Consider ${opts.altName} as an alternate — their on-time rate is stronger on the same history threshold.`
    : `${opts.supplierName} has been late on roughly ${opts.latePct}% of closed orders (${opts.completed} completed). Review alternate suppliers before the next reorder.`;
}

export function templatePriceIncrease(opts: {
  supplierLabel: string;
  title: string;
  fromCost: number;
  toCost: number;
  effective: string;
}) {
  return `${opts.supplierLabel} raised ${opts.title} from $${opts.fromCost.toFixed(2)} to $${opts.toCost.toFixed(2)} effective ${opts.effective}.`;
}

export function templateDraftPoSuggestion(opts: {
  poNumber: string;
  lineCount: number;
  supplierName: string;
  lineBody: string;
}) {
  return {
    summary: `Draft ${opts.poNumber} suggested for ${opts.lineCount} low-stock SKU${opts.lineCount === 1 ? "" : "s"} via ${opts.supplierName} (cheapest confirmed unit cost). Review before sending — not sent.`,
    body: opts.lineBody,
  };
}

export function templateMarginCompression(opts: {
  supplierLabel: string;
  title: string;
  fromMarginPct: number;
  toMarginPct: number;
}) {
  return `${opts.supplierLabel}'s price increase dropped your margin on ${opts.title} from ${opts.fromMarginPct}% to ${opts.toMarginPct}%.`;
}

export function templateQualityPattern(opts: {
  supplierName: string;
  issueOrders: number;
  lookback: number;
  primaryCondition: "damaged" | "wrong_item" | "backorder" | "quality";
}) {
  const label =
    opts.primaryCondition === "damaged"
      ? "damaged shipments"
      : opts.primaryCondition === "wrong_item"
        ? "wrong-item shipments"
        : opts.primaryCondition === "backorder"
          ? "backorder issues"
          : "quality issues";
  return `${opts.supplierName} has had ${label} on ${opts.issueOrders} of the last ${opts.lookback} orders.`;
}

export function templateReorderCadence(opts: {
  supplierName: string;
  cadenceDays: number;
  orderCount: number;
  spanMonths: number;
  daysSinceLast: number;
}) {
  const span =
    opts.spanMonths <= 1
      ? "the last month"
      : `the last ${opts.spanMonths} months`;
  return `You've ordered from ${opts.supplierName} roughly every ${opts.cadenceDays} days for ${span} (${opts.orderCount} orders) — it's been ${opts.daysSinceLast}.`;
}

export function templateMissingDocuments(opts: {
  poNumber: string;
  supplierName: string;
}) {
  return `${opts.poNumber} from ${opts.supplierName} is closed with no invoice or packing slip attached.`;
}

export function templateMissingDocumentsPattern(opts: {
  supplierName: string;
  missingCount: number;
  closedCount: number;
}) {
  return `${opts.supplierName} has ${opts.missingCount} of ${opts.closedCount} closed POs with no invoice or packing slip attached.`;
}

export function templateCatalogIncomplete(opts: {
  supplierLabel: string;
  title: string;
  missing: string[];
}) {
  const fields = opts.missing.join(" and ");
  return `${opts.supplierLabel}'s catalog entry for ${opts.title} is missing ${fields}.`;
}

export function templateCatalogPriceStale(opts: {
  supplierLabel: string;
  title: string;
  daysStale: number;
  lastEffective: string;
}) {
  return `${opts.supplierLabel}'s catalog price for ${opts.title} hasn't been updated in ${opts.daysStale}+ days (last effective ${opts.lastEffective}).`;
}

function marginPct(retail: number, cost: number): number | null {
  if (!(retail > 0) || !Number.isFinite(cost)) return null;
  return Math.round(((retail - cost) / retail) * 1000) / 10;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function daysBetweenUTC(a: string, b: string): number {
  const ms =
    Date.parse(`${b.slice(0, 10)}T00:00:00Z`) -
    Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

async function recentInsightForProduct(
  supabase: SupabaseClient,
  workspaceId: string,
  insightType: InsightType,
  supplierProductId: string,
  withinHours: number,
) {
  const since = daysAgoISO(Math.ceil(withinHours / 24));
  const { data } = await supabase
    .from("ai_insights")
    .select("id, supporting_data")
    .eq("workspace_id", workspaceId)
    .eq("insight_type", insightType)
    .eq("dismissed", false)
    .gte("generated_at", since)
    .limit(40);
  return (data ?? []).some(
    (row) =>
      (row.supporting_data as { supplier_product_id?: string })
        ?.supplier_product_id === supplierProductId,
  );
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

  const narrated = await narrateInsight({
    insightType: "daily_digest",
    facts: {
      workspace_name: gate.name,
      greeting_name: greetingName,
      counts: {
        waiting_confirmation: queues.waiting.length,
        overdue_past_requested_ship: queues.overdue.length,
        arriving_today: queues.arriving.length,
        ready_to_receive: queues.ready.length,
        low_stock_skus: lowStockCount,
      },
      waiting_pos: queues.waiting.slice(0, 5).map((po) => ({
        po_number: po.po_number,
        supplier: supplierName(po),
        status: po.status,
      })),
      overdue_pos: queues.overdue.slice(0, 5).map((po) => ({
        po_number: po.po_number,
        supplier: supplierName(po),
      })),
      ready_pos: queues.ready.slice(0, 5).map((po) => ({
        po_number: po.po_number,
        supplier: supplierName(po),
      })),
      cta: "Open Requisly in Shopify Admin → Today's Work to act on these items.",
    },
    fallback: { summary: composed.summary, body: composed.body },
  });

  const finalSummary = narrated.summary;
  const finalBody = narrated.body ?? composed.body;

  const email = await sendDigestEmail({
    to: recipients,
    subject: composed.subject,
    body: finalBody,
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
    summary: finalSummary,
    body: finalBody,
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
      narration_source: narrated.source,
      narration_error: narrated.error ?? null,
      model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
    },
  });

  return {
    insightId,
    digest: {
      subject: composed.subject,
      body: finalBody,
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
    const fallback = templatePoUnopened(po);
    const narrated = await narrateInsight({
      insightType: "po_unopened",
      facts: {
        po_number: po.po_number,
        supplier_name: supplierName(po),
        status: po.status,
        days_unopened_threshold: UNOPENED_DAYS,
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "po_unopened",
        supplier_id: po.supplier_id,
        po_id: po.id,
        summary: narrated.summary,
        supporting_data: {
          days: UNOPENED_DAYS,
          status: po.status,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
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
    const fallback = templatePoUnconfirmed(po);
    const narrated = await narrateInsight({
      insightType: "po_unconfirmed",
      facts: {
        po_number: po.po_number,
        supplier_name: supplierName(po),
        status: po.status,
        days_unconfirmed_threshold: UNCONFIRMED_DAYS,
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "po_unconfirmed",
        supplier_id: po.supplier_id,
        po_id: po.id,
        summary: narrated.summary,
        supporting_data: {
          days: UNCONFIRMED_DAYS,
          status: po.status,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
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
    const fallback = templateShipmentLate(po);
    const narrated = await narrateInsight({
      insightType: "shipment_late",
      facts: {
        po_number: po.po_number,
        supplier_name: supplierName(po),
        status: po.status,
        estimated_arrival_date: po.estimated_arrival_date,
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "shipment_late",
        supplier_id: po.supplier_id,
        po_id: po.id,
        summary: narrated.summary,
        supporting_data: {
          estimated_arrival_date: po.estimated_arrival_date,
          status: po.status,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
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
    const supplierLabel = nameById.get(supplierId) ?? "Supplier";
    const altName = alt ? nameById.get(alt.supplier_id) ?? null : null;
    const fallback = templateAlternateSupplier({
      supplierName: supplierLabel,
      latePct,
      completed,
      altName,
    });
    const narrated = await narrateInsight({
      insightType: "alternate_supplier",
      facts: {
        supplier_name: supplierLabel,
        completed_pos: completed,
        on_time_pct: onTime,
        late_pct: latePct,
        alternate_supplier_name: altName,
        alternate_on_time_pct: alt ? Number(alt.on_time_pct) : null,
        scorecard_min_completed_pos: SCORECARD_MIN_COMPLETED_POS,
      },
      fallback: { summary: fallback },
    });

    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "supplier",
        insight_type: "alternate_supplier",
        supplier_id: supplierId,
        summary: narrated.summary,
        supporting_data: {
          completed_pos: completed,
          on_time_pct: onTime,
          alternate_supplier_id: alt?.supplier_id ?? null,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
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
    const fallback = templatePriceIncrease({
      supplierLabel,
      title: sp.title,
      fromCost,
      toCost,
      effective,
    });
    const narrated = await narrateInsight({
      insightType: "price_increase",
      facts: {
        supplier_name: supplierLabel,
        product_title: sp.title,
        sku: sp.sku,
        from_unit_cost: fromCost,
        to_unit_cost: toCost,
        effective_date: effective,
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "procurement",
        insight_type: "price_increase",
        supplier_id: sp.supplier_id,
        summary: narrated.summary,
        supporting_data: {
          supplier_product_id: sp.id,
          sku: sp.sku,
          from_unit_cost: fromCost,
          to_unit_cost: toCost,
          effective_date: effective,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
      }),
    );
  }

  // (b) Low-stock → draft PO with cheapest confirmed supplier product.
  const { workspaceThreshold: threshold, variants: lowStock } =
    await listLowStockVariants(supabase, workspaceId);
  const lowVariants = lowStock.slice(0, 5).map((v) => [
    v.productVariantId,
    { onHand: v.onHand, locationId: v.locationId },
  ]) as Array<[string, { onHand: number; locationId: string | null }]>;

  if (lowVariants.length) {
    if (
      opts?.force ||
      !(await hasRecentInsight(supabase, workspaceId, "draft_po_suggestion", {
        withinHours: 48,
      }))
    ) {
      // Pick cheapest supplier_product among linked variants.
      const variantIds = lowVariants.map(([id]) => id);
      const onHandByVariant = new Map(lowVariants);
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

        const lineBody = chosenLines
          .map(
            (l) =>
              `${l.description} × ${l.qty} @ $${l.unit_cost.toFixed(2)}`,
          )
          .join("\n");
        const fallback = templateDraftPoSuggestion({
          poNumber: created.poNumber,
          lineCount: chosenLines.length,
          supplierName: chosenLines[0].supplier_name,
          lineBody,
        });
        const narrated = await narrateInsight({
          insightType: "draft_po_suggestion",
          facts: {
            po_number: created.poNumber,
            supplier_name: chosenLines[0].supplier_name,
            line_count: chosenLines.length,
            threshold,
            auto_sent: false,
            lines: chosenLines.map((l) => ({
              description: l.description,
              sku: l.sku,
              qty: l.qty,
              unit_cost: l.unit_cost,
            })),
            review_required: true,
          },
          fallback,
        });

        ids.push(
          await insertInsight(supabase, {
            workspace_id: workspaceId,
            agent: "procurement",
            insight_type: "draft_po_suggestion",
            supplier_id: chosenSupplier,
            po_id: created.id,
            summary: narrated.summary,
            body: narrated.body ?? fallback.body,
            supporting_data: {
              po_id: created.id,
              po_number: created.poNumber,
              threshold,
              lines: chosenLines,
              ai_suggested: true,
              auto_sent: false,
              narration_source: narrated.source,
              narration_error: narrated.error ?? null,
              model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
            },
          }),
        );
      }
    }
  }

  return ids;
}

/** Margin Agent — retail − unit cost compression after catalog price changes. */
export async function runMarginAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) return [];

  const ids: string[] = [];
  const today = todayUTC();

  const { data: products, error: pErr } = await supabase
    .from("supplier_products")
    .select(
      "id, title, sku, supplier_id, product_variant_id, suppliers(name), product_variants(title, retail_price)",
    )
    .eq("workspace_id", workspaceId)
    .not("product_variant_id", "is", null);
  if (pErr) throw new Error(pErr.message);

  for (const sp of products ?? []) {
    const variant = sp.product_variants as {
      title: string | null;
      retail_price: number | string | null;
    } | null;
    const retail = Number(variant?.retail_price);
    if (!(retail > 0)) continue;

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
      current.effective_date >= daysAgoISO(60).slice(0, 10)
    ) {
      fromCost = Number(prior.unit_cost);
      toCost = Number(current.unit_cost);
      effective = current.effective_date;
    } else {
      continue;
    }

    const fromMargin = marginPct(retail, fromCost);
    const toMargin = marginPct(retail, toCost);
    if (fromMargin == null || toMargin == null) continue;
    const dropPp = fromMargin - toMargin;
    if (dropPp < MARGIN_COMPRESSION_PP) continue;

    if (
      !opts?.force &&
      (await recentInsightForProduct(
        supabase,
        workspaceId,
        "margin_compression",
        sp.id,
        168,
      ))
    ) {
      continue;
    }

    const supplierLabel =
      (sp.suppliers as { name: string } | null)?.name ?? "Supplier";
    const title = sp.title || variant?.title || "product";
    const fallback = templateMarginCompression({
      supplierLabel,
      title,
      fromMarginPct: Math.round(fromMargin),
      toMarginPct: Math.round(toMargin),
    });
    const narrated = await narrateInsight({
      insightType: "margin_compression",
      facts: {
        supplier_name: supplierLabel,
        product_title: title,
        sku: sp.sku,
        retail_price: retail,
        from_unit_cost: fromCost,
        to_unit_cost: toCost,
        from_margin_pct: fromMargin,
        to_margin_pct: toMargin,
        margin_drop_pp: dropPp,
        compression_threshold_pp: MARGIN_COMPRESSION_PP,
        effective_date: effective,
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "margin",
        insight_type: "margin_compression",
        supplier_id: sp.supplier_id,
        summary: narrated.summary,
        supporting_data: {
          supplier_product_id: sp.id,
          product_variant_id: sp.product_variant_id,
          sku: sp.sku,
          retail_price: retail,
          from_unit_cost: fromCost,
          to_unit_cost: toCost,
          from_margin_pct: fromMargin,
          to_margin_pct: toMargin,
          margin_drop_pp: dropPp,
          effective_date: effective,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
      }),
    );
  }

  return ids;
}

/** Quality Agent — receipt condition patterns at supplier level. */
export async function runQualityAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) return [];

  const ids: string[] = [];
  const { data: suppliers, error: sErr } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  if (sErr) throw new Error(sErr.message);

  for (const supplier of suppliers ?? []) {
    const { count: closedCount, error: cErr } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("supplier_id", supplier.id)
      .eq("status", "closed");
    if (cErr) throw new Error(cErr.message);
    if ((closedCount ?? 0) < SCORECARD_MIN_COMPLETED_POS) continue;

    const { data: recentPos, error: pErr } = await supabase
      .from("purchase_orders")
      .select("id, po_number, created_at")
      .eq("workspace_id", workspaceId)
      .eq("supplier_id", supplier.id)
      .eq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(QUALITY_LOOKBACK_POS);
    if (pErr) throw new Error(pErr.message);
    if (!recentPos?.length) continue;

    let issueOrders = 0;
    let damagedOrders = 0;
    let wrongOrders = 0;
    let backorderOrders = 0;
    for (const po of recentPos) {
      const { data: receipts, error: rErr } = await supabase
        .from("receipts")
        .select("id")
        .eq("po_id", po.id);
      if (rErr) throw new Error(rErr.message);
      if (!receipts?.length) continue;

      const receiptIds = receipts.map((r) => r.id);
      const { data: lines, error: lErr } = await supabase
        .from("receipt_line_items")
        .select("condition")
        .in("receipt_id", receiptIds)
        .in("condition", ["damaged", "wrong_item", "backorder"]);
      if (lErr) throw new Error(lErr.message);
      if (!lines?.length) continue;
      issueOrders += 1;
      const conditions = new Set(lines.map((l) => l.condition));
      if (conditions.has("damaged")) damagedOrders += 1;
      if (conditions.has("wrong_item")) wrongOrders += 1;
      if (conditions.has("backorder")) backorderOrders += 1;
    }

    if (issueOrders < QUALITY_MIN_ISSUE_ORDERS) continue;

    if (
      !opts?.force &&
      (await hasRecentInsight(supabase, workspaceId, "quality_pattern", {
        supplierId: supplier.id,
        withinHours: 168,
      }))
    ) {
      continue;
    }

    const primaryCondition =
      damagedOrders >= QUALITY_MIN_ISSUE_ORDERS
        ? ("damaged" as const)
        : wrongOrders >= QUALITY_MIN_ISSUE_ORDERS
          ? ("wrong_item" as const)
          : backorderOrders >= QUALITY_MIN_ISSUE_ORDERS
            ? ("backorder" as const)
            : damagedOrders >= wrongOrders && damagedOrders >= backorderOrders
              ? ("damaged" as const)
              : wrongOrders >= backorderOrders
                ? ("wrong_item" as const)
                : backorderOrders > 0
                  ? ("backorder" as const)
                  : ("quality" as const);

    const lookback = recentPos.length;
    const fallback = templateQualityPattern({
      supplierName: supplier.name,
      issueOrders:
        primaryCondition === "damaged"
          ? damagedOrders
          : primaryCondition === "wrong_item"
            ? wrongOrders
            : primaryCondition === "backorder"
              ? backorderOrders
              : issueOrders,
      lookback,
      primaryCondition,
    });
    const narrated = await narrateInsight({
      insightType: "quality_pattern",
      facts: {
        supplier_name: supplier.name,
        lookback_orders: lookback,
        issue_orders: issueOrders,
        damaged_orders: damagedOrders,
        wrong_item_orders: wrongOrders,
        backorder_orders: backorderOrders,
        primary_condition: primaryCondition,
        closed_pos_total: closedCount,
        min_closed_pos: SCORECARD_MIN_COMPLETED_POS,
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "quality",
        insight_type: "quality_pattern",
        supplier_id: supplier.id,
        summary: narrated.summary,
        supporting_data: {
          lookback_orders: lookback,
          issue_orders: issueOrders,
          damaged_orders: damagedOrders,
          wrong_item_orders: wrongOrders,
          backorder_orders: backorderOrders,
          primary_condition: primaryCondition,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
      }),
    );
  }

  return ids;
}

/**
 * Reorder Cadence Agent — PO order-date rhythm only (never sales velocity).
 */
export async function runReorderCadenceAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) return [];

  const ids: string[] = [];
  const today = todayUTC();
  const { data: suppliers, error: sErr } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  if (sErr) throw new Error(sErr.message);

  for (const supplier of suppliers ?? []) {
    const { data: pos, error: pErr } = await supabase
      .from("purchase_orders")
      .select("id, created_at, status")
      .eq("workspace_id", workspaceId)
      .eq("supplier_id", supplier.id)
      .order("created_at", { ascending: true });
    if (pErr) throw new Error(pErr.message);
    const eligiblePos = (pos ?? []).filter(
      (p) => p.status !== "draft" && p.status !== "cancelled",
    );
    if (eligiblePos.length < REORDER_MIN_ORDERS) continue;

    // Use the most recent streak of orders (last 8) and keep the longest
    // stable gap suffix from "now" backwards — cadence is a recent rhythm.
    const sample = eligiblePos.slice(-Math.min(8, eligiblePos.length));
    if (sample.length < REORDER_MIN_ORDERS) continue;

    const dates = sample.map((p) => p.created_at.slice(0, 10));
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetweenUTC(dates[i - 1], dates[i]);
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length < REORDER_MIN_ORDERS - 1) continue;

    // Stable run must include the most recent gap (anchored at "now").
    let anchored: number[] | null = null;
    for (let len = gaps.length; len >= REORDER_MIN_ORDERS - 1; len--) {
      const suffix = gaps.slice(gaps.length - len);
      const mean = suffix.reduce((a, b) => a + b, 0) / suffix.length;
      if (!(mean >= 7)) continue;
      const variance =
        suffix.reduce((a, b) => a + (b - mean) ** 2, 0) / suffix.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      if (cv <= REORDER_GAP_CV_MAX) {
        anchored = suffix;
        break; // longest first
      }
    }
    if (!anchored) continue;

    const cadence = Math.round(median(anchored));
    if (cadence < 7) continue;
    const mean = anchored.reduce((a, b) => a + b, 0) / anchored.length;
    const variance =
      anchored.reduce((a, b) => a + (b - mean) ** 2, 0) / anchored.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;

    const lastDate = dates[dates.length - 1];
    const daysSinceLast = daysBetweenUTC(lastDate, today);
    if (daysSinceLast < Math.round(cadence * REORDER_APPROACH_FRAC)) continue;

    if (
      !opts?.force &&
      (await hasRecentInsight(supabase, workspaceId, "reorder_cadence", {
        supplierId: supplier.id,
        withinHours: 168,
      }))
    ) {
      continue;
    }

    const patternOrderCount = anchored.length + 1;
    const patternStartDate = dates[dates.length - patternOrderCount];
    const spanDays = daysBetweenUTC(patternStartDate, lastDate);
    const spanMonths = Math.max(1, Math.round(spanDays / 30));
    const fallback = templateReorderCadence({
      supplierName: supplier.name,
      cadenceDays: cadence,
      orderCount: patternOrderCount,
      spanMonths,
      daysSinceLast,
    });
    const narrated = await narrateInsight({
      insightType: "reorder_cadence",
      facts: {
        supplier_name: supplier.name,
        cadence_days: cadence,
        days_since_last_order: daysSinceLast,
        order_count_in_pattern: patternOrderCount,
        order_dates: dates.slice(-patternOrderCount),
        gaps_days: anchored,
        span_months: spanMonths,
        note: "Procurement rhythm from PO history only — not sales velocity.",
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "reorder",
        insight_type: "reorder_cadence",
        supplier_id: supplier.id,
        summary: narrated.summary,
        supporting_data: {
          cadence_days: cadence,
          days_since_last_order: daysSinceLast,
          order_count_in_pattern: patternOrderCount,
          order_dates: dates.slice(-patternOrderCount),
          gaps_days: anchored,
          gap_cv: cv,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
      }),
    );
  }

  return ids;
}

/** Documentation Agent — closed POs missing invoice / packing slip. */
export async function runDocumentationAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) return [];

  const ids: string[] = [];
  let poDocInsights = 0;
  const { data: closed, error: cErr } = await supabase
    .from("purchase_orders")
    .select("id, po_number, supplier_id, created_at, suppliers(name)")
    .eq("workspace_id", workspaceId)
    .eq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(40);
  if (cErr) throw new Error(cErr.message);

  for (const po of closed ?? []) {
    const sid = po.supplier_id as string;
    const sname =
      (po.suppliers as { name: string } | null)?.name ?? "Supplier";

    const { data: docs, error: dErr } = await supabase
      .from("po_documents")
      .select("id, kind")
      .eq("po_id", po.id)
      .in("kind", ["invoice", "packing_slip"]);
    if (dErr) throw new Error(dErr.message);

    if ((docs ?? []).length === 0) {
      if (
        poDocInsights < 5 &&
        (opts?.force ||
          !(await hasRecentInsight(supabase, workspaceId, "missing_documents", {
            poId: po.id,
            withinHours: 168,
          })))
      ) {
        const fallback = templateMissingDocuments({
          poNumber: po.po_number,
          supplierName: sname,
        });
        const narrated = await narrateInsight({
          insightType: "missing_documents",
          facts: {
            po_number: po.po_number,
            supplier_name: sname,
            status: "closed",
            required_document_kinds: ["invoice", "packing_slip"],
            attached_invoice_or_packing_slip: false,
          },
          fallback: { summary: fallback },
        });
        ids.push(
          await insertInsight(supabase, {
            workspace_id: workspaceId,
            agent: "documentation",
            insight_type: "missing_documents",
            supplier_id: sid,
            po_id: po.id,
            summary: narrated.summary,
            supporting_data: {
              required_kinds: ["invoice", "packing_slip"],
              narration_source: narrated.source,
              narration_error: narrated.error ?? null,
              model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
            },
          }),
        );
        poDocInsights += 1;
      }
    }
  }

  // Supplier-level pattern across full closed history (not limited to the 40 sample).
  const { data: allSuppliers, error: asErr } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  if (asErr) throw new Error(asErr.message);

  for (const supplier of allSuppliers ?? []) {
    const supplierId = supplier.id;
    const { data: allClosed, error: aErr } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("supplier_id", supplierId)
      .eq("status", "closed");
    if (aErr) throw new Error(aErr.message);

    let missingCount = 0;
    const samplePoIds: string[] = [];
    for (const po of allClosed ?? []) {
      const { data: docs } = await supabase
        .from("po_documents")
        .select("id")
        .eq("po_id", po.id)
        .in("kind", ["invoice", "packing_slip"])
        .limit(1);
      if (!docs?.length) {
        missingCount += 1;
        if (samplePoIds.length < 5) samplePoIds.push(po.id);
      }
    }
    const closedCount = allClosed?.length ?? 0;
    if (missingCount < DOCS_PATTERN_MIN_POS) continue;
    if (closedCount < SCORECARD_MIN_COMPLETED_POS) continue;
    // Require a repeated pattern (≥30% of closed, and ≥3).
    if (missingCount / closedCount < 0.3) continue;

    if (
      !opts?.force &&
      (await hasRecentInsight(
        supabase,
        workspaceId,
        "missing_documents_pattern",
        { supplierId, withinHours: 168 },
      ))
    ) {
      continue;
    }

    const fallback = templateMissingDocumentsPattern({
      supplierName: supplier.name,
      missingCount,
      closedCount,
    });
    const narrated = await narrateInsight({
      insightType: "missing_documents_pattern",
      facts: {
        supplier_name: supplier.name,
        closed_pos: closedCount,
        missing_invoice_or_packing_slip: missingCount,
        min_pattern_count: DOCS_PATTERN_MIN_POS,
        required_document_kinds: ["invoice", "packing_slip"],
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "documentation",
        insight_type: "missing_documents_pattern",
        supplier_id: supplierId,
        summary: narrated.summary,
        supporting_data: {
          closed_pos: closedCount,
          missing_count: missingCount,
          sample_po_ids: samplePoIds,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
      }),
    );
  }

  return ids;
}

/** Data Hygiene Agent — incomplete catalog fields + stale prices. */
export async function runDataHygieneAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) return [];

  const ids: string[] = [];
  const today = todayUTC();
  const staleBefore = daysAgoISO(CATALOG_STALE_DAYS).slice(0, 10);

  const { data: products, error: pErr } = await supabase
    .from("supplier_products")
    .select("id, title, sku, supplier_id, moq, lead_time_days, suppliers(name)")
    .eq("workspace_id", workspaceId)
    .limit(80);
  if (pErr) throw new Error(pErr.message);

  let incompleteEmitted = 0;
  let staleEmitted = 0;

  for (const sp of products ?? []) {
    const supplierLabel =
      (sp.suppliers as { name: string } | null)?.name ?? "Supplier";
    const missing: string[] = [];
    if (sp.moq == null) missing.push("MOQ");
    if (sp.lead_time_days == null) missing.push("lead time");

    if (missing.length && incompleteEmitted < 5) {
      if (
        opts?.force ||
        !(await recentInsightForProduct(
          supabase,
          workspaceId,
          "catalog_incomplete",
          sp.id,
          168,
        ))
      ) {
        const fallback = templateCatalogIncomplete({
          supplierLabel,
          title: sp.title,
          missing,
        });
        const narrated = await narrateInsight({
          insightType: "catalog_incomplete",
          facts: {
            supplier_name: supplierLabel,
            product_title: sp.title,
            sku: sp.sku,
            missing_fields: missing,
            moq: sp.moq,
            lead_time_days: sp.lead_time_days,
          },
          fallback: { summary: fallback },
        });
        ids.push(
          await insertInsight(supabase, {
            workspace_id: workspaceId,
            agent: "hygiene",
            insight_type: "catalog_incomplete",
            supplier_id: sp.supplier_id,
            summary: narrated.summary,
            supporting_data: {
              supplier_product_id: sp.id,
              sku: sp.sku,
              missing_fields: missing,
              narration_source: narrated.source,
              narration_error: narrated.error ?? null,
              model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
            },
          }),
        );
        incompleteEmitted += 1;
      }
    }

    const { data: prices, error: priceErr } = await supabase
      .from("supplier_product_prices")
      .select("unit_cost, effective_date")
      .eq("supplier_product_id", sp.id)
      .lte("effective_date", today)
      .order("effective_date", { ascending: false })
      .limit(1);
    if (priceErr) throw new Error(priceErr.message);
    const latest = prices?.[0];
    if (!latest) continue;
    if (latest.effective_date > staleBefore) continue;
    if (staleEmitted >= 5) continue;

    const daysStale = daysBetweenUTC(latest.effective_date, today);
    if (
      !opts?.force &&
      (await recentInsightForProduct(
        supabase,
        workspaceId,
        "catalog_price_stale",
        sp.id,
        168,
      ))
    ) {
      continue;
    }

    const fallback = templateCatalogPriceStale({
      supplierLabel,
      title: sp.title,
      daysStale,
      lastEffective: latest.effective_date,
    });
    const narrated = await narrateInsight({
      insightType: "catalog_price_stale",
      facts: {
        supplier_name: supplierLabel,
        product_title: sp.title,
        sku: sp.sku,
        last_effective_date: latest.effective_date,
        days_since_update: daysStale,
        stale_threshold_days: CATALOG_STALE_DAYS,
        unit_cost: Number(latest.unit_cost),
      },
      fallback: { summary: fallback },
    });
    ids.push(
      await insertInsight(supabase, {
        workspace_id: workspaceId,
        agent: "hygiene",
        insight_type: "catalog_price_stale",
        supplier_id: sp.supplier_id,
        summary: narrated.summary,
        supporting_data: {
          supplier_product_id: sp.id,
          sku: sp.sku,
          last_effective_date: latest.effective_date,
          days_since_update: daysStale,
          stale_threshold_days: CATALOG_STALE_DAYS,
          narration_source: narrated.source,
          narration_error: narrated.error ?? null,
          model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
        },
      }),
    );
    staleEmitted += 1;
  }

  return ids;
}

export function templateOnboardingNudge(opts: {
  workspaceName: string;
  nextStepLabel: string;
  nextStepHref: string;
  daysStalled: number;
}) {
  return {
    summary: `You're ${opts.daysStalled}+ days into setup and still haven't finished — next up: ${opts.nextStepLabel}.`,
    body: [
      `Hi from Requisly Operations.`,
      "",
      `Your checklist for ${opts.workspaceName} is still open.`,
      `Next step: ${opts.nextStepLabel}`,
      `Open Requisly → Today's Work to continue (${opts.nextStepHref}).`,
      "",
      "Or skip the checklist anytime from Today's Work.",
      "",
      "— Requisly Operations Agent",
    ].join("\n"),
  };
}

/**
 * Re-engagement when a merchant stalls mid-checklist.
 * Does NOT require the closed-PO insights gate — new merchants need this.
 */
export async function runOnboardingNudgeAgent(
  workspaceId: string,
  opts?: { force?: boolean; supabase?: SupabaseClient },
): Promise<string[]> {
  const supabase = opts?.supabase ?? createServiceClient();
  const {
    getOnboardingState,
    markOnboardingNudgeSent,
    ONBOARDING_STALL_DAYS,
  } = await import("./onboarding.server");

  const state = await getOnboardingState(workspaceId, { supabase });
  if (!state.flags.welcome_completed_at) return [];
  if (state.flags.checklist_skipped_at) return [];
  if (state.allStepsDone) return [];
  if (!state.flags.stalled_at) return [];

  const stalledMs =
    Date.now() - Date.parse(state.flags.stalled_at);
  const daysStalled = Math.floor(stalledMs / 86_400_000);
  if (!opts?.force && daysStalled < ONBOARDING_STALL_DAYS) return [];

  if (
    !opts?.force &&
    state.flags.last_nudge_at &&
    Date.now() - Date.parse(state.flags.last_nudge_at) < 48 * 60 * 60 * 1000
  ) {
    return [];
  }

  if (
    !opts?.force &&
    (await hasRecentInsight(supabase, workspaceId, "onboarding_nudge", {
      withinHours: 48,
    }))
  ) {
    return [];
  }

  const next = state.steps.find((s) => !s.done);
  if (!next) return [];

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  const workspaceName = workspace?.name ?? "your workspace";

  const composed = templateOnboardingNudge({
    workspaceName,
    nextStepLabel: next.label,
    nextStepHref: next.href,
    daysStalled: Math.max(daysStalled, ONBOARDING_STALL_DAYS),
  });

  const narrated = await narrateInsight({
    insightType: "onboarding_nudge",
    facts: {
      workspace_name: workspaceName,
      days_stalled: daysStalled,
      next_step_label: next.label,
      next_step_href: next.href,
      checklist: state.steps,
      supplier_count: state.supplierCount,
      sent_po_count: state.sentPoCount,
      cta: "Open Requisly in Shopify Admin → Today's Work to finish setup.",
    },
    fallback: { summary: composed.summary, body: composed.body },
  });

  const recipients = await resolveDigestRecipients(supabase, workspaceId);
  const email = await sendDigestEmail({
    to: recipients,
    subject: `Finish setup in Requisly — ${next.label}`,
    body: narrated.body ?? composed.body,
  });

  const insightId = await insertInsight(supabase, {
    workspace_id: workspaceId,
    agent: "operations",
    insight_type: "onboarding_nudge",
    summary: narrated.summary,
    body: narrated.body ?? composed.body,
    supporting_data: {
      days_stalled: daysStalled,
      next_step: next.id,
      emailedTo: recipients,
      emailSent: email.sent,
      emailError: email.error ?? null,
      narration_source: narrated.source,
      narration_error: narrated.error ?? null,
      model: narrated.source === "claude" ? "claude-haiku-4-5" : null,
    },
  });

  await markOnboardingNudgeSent(workspaceId);
  return [insightId];
}

/** Run all in-lane agents for one workspace. */
export async function runAllAgentsForWorkspace(
  workspaceId: string,
  opts?: { force?: boolean },
): Promise<AgentRunResult> {
  const supabase = createServiceClient();

  // Onboarding re-engagement runs even before the closed-PO insights gate.
  const nudgeIds = await runOnboardingNudgeAgent(workspaceId, {
    force: opts?.force,
    supabase,
  });

  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  if (!gate.eligible) {
    return {
      workspaceId,
      workspaceName: gate.name,
      eligible: false,
      reason: gate.reason,
      insightsCreated: nudgeIds.length,
      insightIds: nudgeIds,
    };
  }

  const agentOpts = { force: opts?.force, supabase };
  const ops = await runOperationsAgent(workspaceId, agentOpts);
  const supplierIds = await runSupplierAgent(workspaceId, agentOpts);
  const procurementIds = await runProcurementAgent(workspaceId, agentOpts);
  const marginIds = await runMarginAgent(workspaceId, agentOpts);
  const qualityIds = await runQualityAgent(workspaceId, agentOpts);
  const reorderIds = await runReorderCadenceAgent(workspaceId, agentOpts);
  const documentationIds = await runDocumentationAgent(workspaceId, agentOpts);
  const hygieneIds = await runDataHygieneAgent(workspaceId, agentOpts);

  const insightIds = [
    ...nudgeIds,
    ...(ops.insightId ? [ops.insightId] : []),
    ...supplierIds,
    ...procurementIds,
    ...marginIds,
    ...qualityIds,
    ...reorderIds,
    ...documentationIds,
    ...hygieneIds,
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
