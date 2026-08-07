import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { performance } from "node:perf_hooks";

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ws = "eb7e12e6-4572-466a-8424-71cc515502cd";
const today = new Date().toISOString().slice(0, 10);

async function loadOk() {
  const started = performance.now();
  const results = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, suppliers(name), updated_at")
      .eq("workspace_id", ws)
      .in("status", ["sent", "viewed"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, confirmed_ship_date, requested_ship_date, suppliers(name)",
      )
      .eq("workspace_id", ws)
      .or(`confirmed_ship_date.eq.${today},requested_ship_date.eq.${today}`)
      .in("status", ["confirmed", "production", "shipped", "in_transit"])
      .limit(8),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, suppliers(name), updated_at")
      .eq("workspace_id", ws)
      .in("status", ["shipped", "in_transit", "partially_received"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, requested_ship_date, confirmed_ship_date, suppliers(name)",
      )
      .eq("workspace_id", ws)
      .in("status", ["sent", "viewed", "confirmed", "production"])
      .lt("requested_ship_date", today)
      .limit(8),
    supabase
      .from("po_timeline_events")
      .select(
        "id, event_type, actor, occurred_at, po_id, purchase_orders!inner(po_number, workspace_id, suppliers(name))",
      )
      .eq("purchase_orders.workspace_id", ws)
      .in("actor", ["supplier", "system"])
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);
  const ms = Math.round(performance.now() - started);
  const failures = results
    .map((r, i) => (r.error ? `${i}:${r.error.message}` : null))
    .filter(Boolean);
  return {
    ms,
    loadError: failures.length ? failures.join(" · ") : null,
    counts: results.map((r) => (r.data ?? []).length),
  };
}

async function loadForceError() {
  const started = performance.now();
  const { error } = await supabase
    .from("purchase_orders")
    .select("__requisly_force_error__")
    .eq("workspace_id", ws)
    .limit(1);
  const ms = Math.round(performance.now() - started);
  return {
    ms,
    loadError: error?.message ?? null,
    wouldShowCriticalBanner: Boolean(error?.message),
  };
}

const ok = await loadOk();
const bad = await loadForceError();
console.log("OK_RESULT", JSON.stringify(ok));
console.log("ERR_RESULT", JSON.stringify(bad));
