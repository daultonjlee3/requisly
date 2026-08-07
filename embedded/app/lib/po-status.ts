/** Golden workflow spine — labels match DESIGN-STANDARD / PHASE-0 states. */
export type PoStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "confirmed"
  | "production"
  | "shipped"
  | "in_transit"
  | "partially_received"
  | "received"
  | "closed"
  | "rejected";

export type TimelineEvent = {
  id: string;
  event_type: PoStatus;
  actor: string;
  occurred_at: string;
  metadata?: Record<string, unknown> | null;
};

export const TIMELINE_STEPS: {
  key: PoStatus;
  label: string;
  skippable?: boolean;
  terminalAlternate?: boolean;
}[] = [
  { key: "draft", label: "Created" },
  { key: "sent", label: "Sent" },
  { key: "viewed", label: "Viewed" },
  { key: "confirmed", label: "Confirmed" },
  { key: "production", label: "Production", skippable: true },
  { key: "shipped", label: "Shipped" },
  { key: "in_transit", label: "In Transit", skippable: true },
  { key: "partially_received", label: "Partially Received" },
  { key: "received", label: "Received" },
  { key: "closed", label: "Closed" },
  { key: "rejected", label: "Rejected", terminalAlternate: true },
];

/** Kanban columns = full golden workflow including Rejected. */
export const KANBAN_COLUMNS = TIMELINE_STEPS;

const ORDER = TIMELINE_STEPS.map((s) => s.key);

export function statusLabel(status: PoStatus): string {
  return TIMELINE_STEPS.find((s) => s.key === status)?.label ?? status;
}

export function statusRank(status: PoStatus): number {
  return ORDER.indexOf(status);
}

export function statusBadgeTone(
  status: PoStatus,
): "info" | "success" | "warning" | "critical" | undefined {
  switch (status) {
    case "sent":
    case "viewed":
      return "info";
    case "confirmed":
    case "production":
    case "received":
    case "closed":
      return "success";
    case "shipped":
    case "in_transit":
    case "partially_received":
      return "warning";
    case "rejected":
      return "critical";
    default:
      return undefined;
  }
}

export type TimelineStepState = "done" | "current" | "future" | "skip";

export function buildTimelineState(
  currentStatus: PoStatus,
  events: TimelineEvent[],
) {
  const byType = new Map<PoStatus, TimelineEvent>();
  for (const event of events) {
    if (!byType.has(event.event_type)) {
      byType.set(event.event_type, event);
    }
  }

  const isRejected = currentStatus === "rejected";
  const currentRank = statusRank(currentStatus);

  return TIMELINE_STEPS.filter((step) => {
    if (step.key === "rejected") return isRejected || byType.has("rejected");
    return true;
  }).map((step) => {
    const event = byType.get(step.key);
    const stepRank = statusRank(step.key);
    const isCurrent = step.key === currentStatus;

    if (isRejected) {
      let state: TimelineStepState = "future";
      if (step.key === "rejected") state = "current";
      else if (event || stepRank <= statusRank("viewed")) state = "done";
      else if (step.skippable) state = "skip";
      return {
        ...step,
        state,
        occurredAt: event?.occurred_at ?? null,
      };
    }

    const isSkipped =
      Boolean(step.skippable) &&
      !event &&
      !isCurrent &&
      stepRank < currentRank;

    let state: TimelineStepState = "future";
    if (isCurrent) state = "current";
    else if (isSkipped) state = "skip";
    else if (event || stepRank < currentRank) state = "done";

    return {
      ...step,
      state,
      occurredAt: event?.occurred_at ?? null,
    };
  });
}

/** Progress 0–100 across the happy-path spine (excludes Rejected). */
export function timelineProgress(currentStatus: PoStatus): number {
  const happy = TIMELINE_STEPS.filter((s) => !s.terminalAlternate);
  if (currentStatus === "rejected") return 0;
  const idx = happy.findIndex((s) => s.key === currentStatus);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / happy.length) * 100);
}
