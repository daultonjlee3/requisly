import type { LoaderFunctionArgs } from "@remix-run/node";
import { runAllAgentsForEligibleWorkspaces } from "../lib/ai-agents.server";

/**
 * Cron entry for in-lane AI agents (Vercel Cron → embedded project).
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const workspaceId = url.searchParams.get("workspace_id") ?? undefined;

  try {
    const results = await runAllAgentsForEligibleWorkspaces({
      force,
      workspaceId,
    });
    return Response.json({
      ok: true,
      workspaces: results.length,
      results,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "AI agents cron failed" },
      { status: 500 },
    );
  }
};
