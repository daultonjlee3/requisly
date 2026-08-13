/**
 * Run Phase 3 in-lane agents against a workspace and print the digest email.
 *
 *   npx tsx --env-file=embedded/.env scripts/run-ai-agents.ts --force
 *   npx tsx --env-file=embedded/.env scripts/run-ai-agents.ts --workspace=<uuid> --force
 */
const DEMO_ID = "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const wsArg = args.find((a) => a.startsWith("--workspace="));
  const workspaceId = wsArg?.split("=")[1] || DEMO_ID;

  const { runAllAgentsForWorkspace } = await import(
    "../embedded/app/lib/ai-agents.server.ts"
  );

  console.log(`Running agents for workspace ${workspaceId} (force=${force})…`);
  const result = await runAllAgentsForWorkspace(workspaceId, { force });

  console.log("\n=== RESULT ===");
  console.log(
    JSON.stringify(
      {
        workspaceId: result.workspaceId,
        workspaceName: result.workspaceName,
        eligible: result.eligible,
        reason: result.reason,
        insightsCreated: result.insightsCreated,
        insightIds: result.insightIds,
        emailSent: result.digest?.emailSent,
        emailedTo: result.digest?.emailedTo,
        emailError: result.digest?.emailError,
      },
      null,
      2,
    ),
  );

  if (result.digest) {
    console.log("\n=== DIGEST EMAIL ===");
    console.log(`Subject: ${result.digest.subject}`);
    console.log("---");
    console.log(result.digest.body);
    console.log("---");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
