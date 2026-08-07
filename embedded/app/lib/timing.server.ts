/**
 * Lightweight server-side timing so p95 can be measured from logs
 * (e.g. grep "[timing]" in Shopify app / Remix server output).
 */
export function startTimer(label: string) {
  const started = performance.now();
  return {
    end(extra?: Record<string, string | number | boolean | null | undefined>) {
      const ms = Math.round(performance.now() - started);
      const bits = Object.entries(extra ?? {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
      console.info(`[timing] ${label} ${ms}ms${bits ? ` ${bits}` : ""}`);
      return ms;
    },
  };
}
