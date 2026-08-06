import type { PoStatus, TimelineEvent } from "@/lib/types";

/** Merchant-facing timeline spine (Created = draft event). */
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

/** Kanban includes Rejected as its own column (terminal, off the happy path). */
export const KANBAN_COLUMNS = TIMELINE_STEPS;

const ORDER = TIMELINE_STEPS.map((s) => s.key);

export function statusLabel(status: PoStatus): string {
  return TIMELINE_STEPS.find((s) => s.key === status)?.label ?? status;
}

export function statusChipClass(status: PoStatus): string {
  switch (status) {
    case "draft":
      return "chip-idle";
    case "sent":
    case "viewed":
      return "chip-sent";
    case "confirmed":
      return "chip-confirmed";
    case "production":
    case "in_transit":
    case "shipped":
      return "chip-transit";
    case "partially_received":
    case "rejected":
      return "chip-alert";
    case "received":
    case "closed":
      return "chip-received";
    default:
      return "chip-idle";
  }
}

export function statusRank(status: PoStatus): number {
  return ORDER.indexOf(status);
}

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
    // Hide Rejected column on the timeline unless this PO was rejected
    if (step.key === "rejected") return isRejected || byType.has("rejected");
    return true;
  }).map((step) => {
    const event = byType.get(step.key);
    const stepRank = statusRank(step.key);
    const isCurrent = step.key === currentStatus;

    if (isRejected) {
      let state: "done" | "current" | "future" | "skip" = "future";
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

    let state: "done" | "current" | "future" | "skip" = "future";
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
