/**
 * Run Inventory Agent against Salt & Fern and print confirmed vs fallback samples.
 *
 *   npx tsx --env-file=embedded/.env scripts/run-inventory-agent-salt-fern.ts --force
 */
const SALT_FERN_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";

async function main() {
  const force = process.argv.includes("--force");
  const {
    runInventoryAgent,
    listActiveInsights,
    workspaceIsInsightEligible,
  } = await import("../embedded/app/lib/ai-agents.server.ts");
  const { createServiceClient } = await import(
    "../embedded/app/lib/supabase.server.ts"
  );

  const supabase = createServiceClient();
  const gate = await workspaceIsInsightEligible(SALT_FERN_ID, supabase);
  console.log("Gate:", gate);
  if (!gate.eligible) {
    console.error("Workspace not insight-eligible");
    process.exit(1);
  }

  const ids = await runInventoryAgent(SALT_FERN_ID, {
    force,
    supabase,
    limit: 5,
  });
  console.log("Created insight ids:", ids);

  const insights = (await listActiveInsights(SALT_FERN_ID, 40)).filter(
    (i) => i.agent === "inventory",
  );

  const confirmed = insights.filter(
    (i) =>
      (i.supporting_data as { lead_time_source?: string }).lead_time_source ===
      "confirmed",
  );
  const fallback = insights.filter(
    (i) =>
      (i.supporting_data as { lead_time_source?: string }).lead_time_source ===
      "fallback_estimate",
  );

  function printOne(label: string, row: (typeof insights)[0] | undefined) {
    console.log(`\n=== ${label} ===`);
    if (!row) {
      console.log("(none)");
      return;
    }
    const sd = row.supporting_data as Record<string, unknown>;
    console.log(
      JSON.stringify(
        {
          summary: row.summary,
          body: row.body,
          insight_type: row.insight_type,
          po_id: row.po_id,
          lead_time_source: sd.lead_time_source,
          confirmed_lead_po_count: sd.confirmed_lead_po_count,
          lead_time_days: sd.lead_time_days,
          velocity_is_synthetic_test: sd.velocity_is_synthetic_test,
          narration_source: sd.narration_source,
          auto_sent: sd.auto_sent,
        },
        null,
        2,
      ),
    );
  }

  printOne("CONFIRMED lead time (expect Ski Wax-style)", confirmed[0]);
  printOne("FALLBACK estimate lead time", fallback[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
