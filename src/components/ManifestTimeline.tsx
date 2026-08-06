import { buildTimelineState } from "@/lib/po-status";
import { shortDate } from "@/lib/format";
import type { PoStatus, TimelineEvent } from "@/lib/types";

export function ManifestTimeline({
  status,
  events,
}: {
  status: PoStatus;
  events: TimelineEvent[];
}) {
  const steps = buildTimelineState(status, events);

  return (
    <div className="manifest-timeline">
      {steps.map((step) => (
        <div key={step.key} className={`manifest-step ${step.state}`}>
          <div className="track" />
          <div className="manifest-node" />
          <div className="manifest-label">{step.label}</div>
          <div className="manifest-date">
            {step.occurredAt ? shortDate(step.occurredAt) : "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
