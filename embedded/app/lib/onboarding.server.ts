/**
 * Merchant onboarding state — welcome, checklist visibility, celebration,
 * guide dismiss, and stalled re-engagement timestamps.
 * Checklist step completion is always derived from real workspace data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase.server";

export type OnboardingFlags = {
  welcome_completed_at?: string | null;
  checklist_skipped_at?: string | null;
  first_po_celebrated_at?: string | null;
  guide_dismissed_at?: string | null;
  last_nudge_at?: string | null;
  stalled_at?: string | null;
};

export type ChecklistStep = {
  id: "connect_store" | "add_supplier" | "send_po";
  label: string;
  done: boolean;
  href: string;
};

export type OnboardingState = {
  flags: OnboardingFlags;
  supplierCount: number;
  sentPoCount: number;
  steps: ChecklistStep[];
  allStepsDone: boolean;
  showWelcome: boolean;
  showChecklist: boolean;
  showGuide: boolean;
  needsActivationCelebrate: boolean;
};

function parseFlags(raw: unknown): OnboardingFlags {
  if (!raw || typeof raw !== "object") return {};
  return raw as OnboardingFlags;
}

async function patchOnboarding(
  workspaceId: string,
  patch: Partial<OnboardingFlags>,
  supabase: SupabaseClient = createServiceClient(),
): Promise<OnboardingFlags> {
  const { data: row, error } = await supabase
    .from("workspaces")
    .select("onboarding")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const next: OnboardingFlags = {
    ...parseFlags(row?.onboarding),
    ...patch,
  };

  const { error: updErr } = await supabase
    .from("workspaces")
    .update({ onboarding: next })
    .eq("id", workspaceId);
  if (updErr) throw new Error(updErr.message);
  return next;
}

export async function getOnboardingState(
  workspaceId: string,
  opts?: { supabase?: SupabaseClient },
): Promise<OnboardingState> {
  const supabase = opts?.supabase ?? createServiceClient();

  const [{ data: workspace, error: wErr }, suppliersRes, posRes] =
    await Promise.all([
      supabase
        .from("workspaces")
        .select("onboarding, shopify_domain")
        .eq("id", workspaceId)
        .maybeSingle(),
      supabase
        .from("suppliers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      supabase
        .from("purchase_orders")
        .select("id, status")
        .eq("workspace_id", workspaceId),
    ]);
  if (wErr) throw new Error(wErr.message);
  if (posRes.error) throw new Error(posRes.error.message);

  const flags = parseFlags(workspace?.onboarding);
  const supplierCount = suppliersRes.count ?? 0;
  const sentPoCount = (posRes.data ?? []).filter(
    (p) => p.status !== "draft" && p.status !== "cancelled",
  ).length;
  const storeConnected = Boolean(workspace?.shopify_domain);

  const steps: ChecklistStep[] = [
    {
      id: "connect_store",
      label: "Connect your Shopify store",
      done: storeConnected,
      href: "/app/products",
    },
    {
      id: "add_supplier",
      label: "Add your first supplier",
      done: supplierCount >= 1,
      href: "/app/suppliers/new?onboarding=1",
    },
    {
      id: "send_po",
      label: "Create and send your first PO",
      done: sentPoCount >= 1,
      href: "/app/purchase-orders/new?onboarding=1",
    },
  ];

  const allStepsDone = steps.every((s) => s.done);
  const showWelcome = !flags.welcome_completed_at;
  const showChecklist =
    Boolean(flags.welcome_completed_at) &&
    !flags.checklist_skipped_at &&
    !allStepsDone;
  const showGuide =
    Boolean(flags.welcome_completed_at) &&
    !flags.guide_dismissed_at &&
    (!allStepsDone || !flags.first_po_celebrated_at);

  // Mark stalled when welcome done and checklist still open.
  if (flags.welcome_completed_at && showChecklist && !flags.stalled_at) {
    await patchOnboarding(
      workspaceId,
      { stalled_at: new Date().toISOString() },
      supabase,
    );
    flags.stalled_at = new Date().toISOString();
  }

  return {
    flags,
    supplierCount,
    sentPoCount,
    steps,
    allStepsDone,
    showWelcome,
    showChecklist,
    showGuide,
    needsActivationCelebrate: Boolean(
      sentPoCount >= 1 && !flags.first_po_celebrated_at,
    ),
  };
}

export async function markWelcomeDone(workspaceId: string) {
  return patchOnboarding(workspaceId, {
    welcome_completed_at: new Date().toISOString(),
    stalled_at: new Date().toISOString(),
  });
}

export async function skipChecklist(workspaceId: string) {
  return patchOnboarding(workspaceId, {
    checklist_skipped_at: new Date().toISOString(),
    stalled_at: null,
  });
}

export async function markFirstPoCelebrated(workspaceId: string) {
  return patchOnboarding(workspaceId, {
    first_po_celebrated_at: new Date().toISOString(),
    stalled_at: null,
  });
}

export async function markGuideDismissed(workspaceId: string) {
  return patchOnboarding(workspaceId, {
    guide_dismissed_at: new Date().toISOString(),
  });
}

export async function markOnboardingNudgeSent(workspaceId: string) {
  return patchOnboarding(workspaceId, {
    last_nudge_at: new Date().toISOString(),
  });
}

export async function clearOnboardingStall(workspaceId: string) {
  return patchOnboarding(workspaceId, { stalled_at: null });
}

/** Narrow exception: resolve the demo workspace for sample Analytics preview. */
export async function resolveDemoWorkspaceId(
  supabase: SupabaseClient = createServiceClient(),
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("is_demo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id as string, name: data.name as string };
}

export const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL?.trim() || "support@requisly.app";

/** Days after stall before Operations re-engagement nudge. */
export const ONBOARDING_STALL_DAYS = 2;
