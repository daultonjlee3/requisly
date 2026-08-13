/**
 * Run only the five new agents and print their insight summaries.
 *
 *   npx tsx --env-file=embedded/.env scripts/run-new-ai-agents.ts --force
 */
const DEMO_ID = "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const wsArg = args.find((a) => a.startsWith("--workspace="));
  const workspaceId = wsArg?.split("=")[1] || DEMO_ID;

  const {
    runMarginAgent,
    runQualityAgent,
    runReorderCadenceAgent,
    runDocumentationAgent,
    runDataHygieneAgent,
    listActiveInsights,
    workspaceIsInsightEligible,
  } = await import("../embedded/app/lib/ai-agents.server.ts");
  const { createServiceClient } = await import(
    "../embedded/app/lib/supabase.server.ts"
  );

  const supabase = createServiceClient();
  const gate = await workspaceIsInsightEligible(workspaceId, supabase);
  console.log("Gate:", gate);
  if (!gate.eligible) process.exit(1);

  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg?.split("=")[1]?.split(",").filter(Boolean) ?? null;
  const should = (name: string) => !only || only.includes(name);

  const opts = { force, supabase };
  const results = {
    margin: should("margin")
      ? await runMarginAgent(workspaceId, opts)
      : [],
    quality: should("quality")
      ? await runQualityAgent(workspaceId, opts)
      : [],
    reorder: should("reorder")
      ? await runReorderCadenceAgent(workspaceId, opts)
      : [],
    documentation: should("documentation")
      ? await runDocumentationAgent(workspaceId, opts)
      : [],
    hygiene: should("hygiene")
      ? await runDataHygieneAgent(workspaceId, opts)
      : [],
  };

  console.log("\nCreated ids:", JSON.stringify(results, null, 2));

  const insights = await listActiveInsights(workspaceId, 80);
  const agents = new Set([
    "margin",
    "quality",
    "reorder",
    "documentation",
    "hygiene",
  ]);
  const fresh = insights.filter((i) => agents.has(i.agent));

  console.log("\n=== NEW AGENT INSIGHTS (demo workspace) ===\n");
  for (const agent of [
    "margin",
    "quality",
    "reorder",
    "documentation",
    "hygiene",
  ]) {
    const rows = fresh.filter((i) => i.agent === agent);
    console.log(`--- ${agent.toUpperCase()} (${rows.length}) ---`);
    if (!rows.length) {
      console.log("(none)\n");
      continue;
    }
    for (const row of rows) {
      console.log(`[${row.insight_type}] ${row.summary}`);
      if (row.body) console.log(`  body: ${row.body}`);
      const support = row.supporting_data as {
        narration_source?: string;
        narration_error?: string | null;
      };
      console.log(
        `  source=${support.narration_source ?? "?"}${support.narration_error ? ` err=${support.narration_error}` : ""}`,
      );
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
