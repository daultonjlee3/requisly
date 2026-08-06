import { scheduledPriceNote } from "@/lib/pricing";

/** Restrained scheduled-price indicator — muted text, not a badge. */
export function ScheduledPriceNote({
  next_unit_cost,
  next_effective_date,
  style = "short",
}: {
  next_unit_cost: number | null;
  next_effective_date: string | null;
  style?: "short" | "full";
}) {
  const note = scheduledPriceNote(
    { next_unit_cost, next_effective_date },
    style,
  );
  if (!note) return null;
  return <div className="price-change-note">{note}</div>;
}
