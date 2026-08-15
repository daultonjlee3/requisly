export type CogsMethod = "weighted_average" | "fifo";

export function cogsMethodLabel(method: CogsMethod): string {
  return method === "fifo" ? "FIFO" : "Weighted Average";
}

/** Card / report heading — never ambiguous which calculation is shown. */
export function cogsCardTitle(method: CogsMethod): string {
  return method === "fifo" ? "COGS (FIFO)" : "COGS (Weighted Average)";
}

export function cogsFeatureLabel(method: CogsMethod): string {
  return `Requisly's COGS (${cogsMethodLabel(method)}, from your real purchase price history).`;
}
