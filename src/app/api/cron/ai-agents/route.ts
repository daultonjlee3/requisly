import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily in-lane agents cron.
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Delegates to the embedded engine (same code as Analytics "Refresh insights").
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const workspaceId = url.searchParams.get("workspace_id") ?? undefined;

  try {
    // Dynamic import keeps Remix-oriented *.server modules out of the edge bundle.
    const { runAllAgentsForEligibleWorkspaces } = await import(
      /* webpackIgnore: true */
      "../../../../../embedded/app/lib/ai-agents.server"
    );

    // Ensure service client can resolve env (admin client proves keys exist).
    createAdminClient();

    const results = await runAllAgentsForEligibleWorkspaces({
      force,
      workspaceId,
    });

    return NextResponse.json({
      ok: true,
      workspaces: results.length,
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI agents cron failed" },
      { status: 500 },
    );
  }
}
