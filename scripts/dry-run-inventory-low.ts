/**
 * Dry-run inventory_low evaluate (no email send).
 *
 *   npx tsx --env-file=embedded/.env scripts/dry-run-inventory-low.ts
 *   npx tsx --env-file=embedded/.env scripts/dry-run-inventory-low.ts --workspace=<uuid>
 */
import { createClient } from "@supabase/supabase-js";

const DEMO_ID = "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");

  const workspaceId =
    process.argv.find((a) => a.startsWith("--workspace="))?.split("=")[1] ||
    DEMO_ID;

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { listLowStockVariants } = await import(
    "../embedded/app/lib/low-stock.server.ts"
  );
  const { evaluateWorkspaceNotifications } = await import(
    "../src/lib/notifications/evaluate.ts"
  );

  const { data: rule } = await admin
    .from("notification_rules")
    .select("id, workspace_id, rule_type, enabled, threshold_value")
    .eq("workspace_id", workspaceId)
    .eq("rule_type", "inventory_low")
    .maybeSingle();

  console.log("Rule:", rule);

  const listed = await listLowStockVariants(admin, workspaceId, {
    ruleThreshold: rule?.threshold_value ?? null,
  });
  console.log(
    `\nLow-stock variants (threshold workspace default=${listed.workspaceThreshold}): ${listed.variants.length}`,
  );
  for (const v of listed.variants.slice(0, 15)) {
    console.log(
      `  - ${v.title}${v.sku ? ` [${v.sku}]` : ""} onHand=${v.onHand} threshold=${v.threshold}`,
    );
  }

  if (!rule) {
    console.log("\nNo inventory_low rule row — skipping evaluate.");
    return;
  }

  const pending = await evaluateWorkspaceNotifications(admin, workspaceId, [
    {
      id: rule.id,
      workspace_id: rule.workspace_id,
      rule_type: "inventory_low",
      enabled: true,
      threshold_value: rule.threshold_value,
    },
  ]);

  console.log(`\nPending notifications after dedup: ${pending.length}`);
  for (const p of pending.slice(0, 10)) {
    console.log(`---\nTo: ${p.recipient_email}\nSubject: ${p.subject}\n${p.body}\n(dedupe=${p.dedupe_key})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
