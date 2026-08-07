import { createServiceClient } from "./supabase.server";
import { money, relativeTime, shortDate } from "./format";
import type { DashRow } from "./po-types";
import { type PoStatus } from "./po-status";

export type { DashRow, PoStatus };

export type TimelineRow = {
  id: string;
  poId: string;
  poNumber: string;
  eventType: string;
  actor: string;
  supplierName: string | null;
  occurredAt: string;
  relative: string;
};

export type DashboardData = {
  waitingConfirmation: DashRow[];
  readyToReceive: DashRow[];
  arrivingToday: DashRow[];
  overdue: DashRow[];
  recentUpdates: TimelineRow[];
  /** Set when any dashboard query failed — never treat as a genuine empty board. */
  loadError: string | null;
};

function supplierName(value: unknown) {
  const s = value as { name: string } | null;
  return s?.name ?? "—";
}

export async function loadDashboard(
  workspaceId: string,
  opts?: { forceError?: boolean },
): Promise<DashboardData> {
  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  if (opts?.forceError) {
    const { error } = await supabase
      .from("purchase_orders")
      .select("__requisly_force_error__")
      .eq("workspace_id", workspaceId)
      .limit(1);
    return {
      waitingConfirmation: [],
      readyToReceive: [],
      arrivingToday: [],
      overdue: [],
      recentUpdates: [],
      loadError:
        error?.message ??
        "Forced dashboard query failure (development diagnostic).",
    };
  }

  const [
    waitingRes,
    arrivingRes,
    readyRes,
    overdueRes,
    updatesRes,
  ] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, suppliers(name), updated_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["sent", "viewed"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, confirmed_ship_date, requested_ship_date, suppliers(name)",
      )
      .eq("workspace_id", workspaceId)
      .or(
        `confirmed_ship_date.eq.${today},requested_ship_date.eq.${today}`,
      )
      .in("status", ["confirmed", "production", "shipped", "in_transit"])
      .limit(8),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, suppliers(name), updated_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["shipped", "in_transit", "partially_received"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, requested_ship_date, confirmed_ship_date, suppliers(name)",
      )
      .eq("workspace_id", workspaceId)
      .in("status", ["sent", "viewed", "confirmed", "production"])
      .lt("requested_ship_date", today)
      .limit(8),
    supabase
      .from("po_timeline_events")
      .select(
        "id, event_type, actor, occurred_at, po_id, purchase_orders!inner(po_number, workspace_id, suppliers(name))",
      )
      .eq("purchase_orders.workspace_id", workspaceId)
      .in("actor", ["supplier", "system"])
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);

  const failures = [
    waitingRes.error && `waiting: ${waitingRes.error.message}`,
    arrivingRes.error && `arriving: ${arrivingRes.error.message}`,
    readyRes.error && `ready: ${readyRes.error.message}`,
    overdueRes.error && `overdue: ${overdueRes.error.message}`,
    updatesRes.error && `updates: ${updatesRes.error.message}`,
  ].filter(Boolean) as string[];

  if (failures.length) {
    return {
      waitingConfirmation: [],
      readyToReceive: [],
      arrivingToday: [],
      overdue: [],
      recentUpdates: [],
      loadError: failures.join(" · "),
    };
  }

  const waitingConfirmation = waitingRes.data ?? [];
  const arrivingToday = arrivingRes.data ?? [];
  const readyToReceive = readyRes.data ?? [];
  const overdue = overdueRes.data ?? [];
  const recentUpdates = updatesRes.data ?? [];

  return {
    loadError: null,
    waitingConfirmation: waitingConfirmation.map((po) => ({
      id: po.id,
      href: `/app/purchase-orders/${po.id}`,
      primary: po.po_number,
      secondary: supplierName(po.suppliers),
      meta: relativeTime(po.updated_at),
      status: po.status as PoStatus,
      right: money(po.total),
    })),
    readyToReceive: readyToReceive.map((po) => ({
      id: po.id,
      href: `/app/purchase-orders/${po.id}/receive`,
      primary: po.po_number,
      secondary: supplierName(po.suppliers),
      meta: relativeTime(po.updated_at),
      status: po.status as PoStatus,
      right: money(po.total),
    })),
    arrivingToday: arrivingToday.map((po) => ({
      id: po.id,
      href: `/app/purchase-orders/${po.id}`,
      primary: po.po_number,
      secondary: supplierName(po.suppliers),
      meta: shortDate(po.confirmed_ship_date || po.requested_ship_date),
      status: po.status as PoStatus,
    })),
    overdue: overdue.map((po) => ({
      id: po.id,
      href: `/app/purchase-orders/${po.id}`,
      primary: po.po_number,
      secondary: supplierName(po.suppliers),
      meta: shortDate(po.requested_ship_date),
      status: po.status as PoStatus,
    })),
    recentUpdates: recentUpdates.map((event) => {
      const po = event.purchase_orders as unknown as {
        po_number: string;
        suppliers: { name: string } | null;
      } | null;
      return {
        id: event.id,
        poId: event.po_id,
        poNumber: po?.po_number ?? "PO",
        eventType: event.event_type,
        actor: event.actor,
        supplierName: po?.suppliers?.name ?? null,
        occurredAt: event.occurred_at,
        relative: relativeTime(event.occurred_at),
      };
    }),
  };
}
