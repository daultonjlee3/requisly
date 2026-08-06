import { NextResponse } from "next/server";
import { evaluateWorkspaceNotifications } from "@/lib/notifications/evaluate";
import { sendPendingNotifications } from "@/lib/notifications/send";
import type { NotificationRule } from "@/lib/notifications/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly cron entrypoint (Vercel Cron or external scheduler).
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: workspaces, error } = await admin
      .from("workspaces")
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let pendingCount = 0;
    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const workspace of workspaces ?? []) {
      const { data: rules, error: rulesError } = await admin
        .from("notification_rules")
        .select("id, workspace_id, rule_type, enabled, threshold_value")
        .eq("workspace_id", workspace.id);

      if (rulesError) {
        errors.push(`${workspace.id}: ${rulesError.message}`);
        continue;
      }

      const pending = await evaluateWorkspaceNotifications(
        admin,
        workspace.id,
        (rules ?? []) as NotificationRule[],
      );
      pendingCount += pending.length;

      const result = await sendPendingNotifications(admin, pending);
      sent += result.sent;
      skipped += result.skipped;
      errors.push(...result.errors);
    }

    return NextResponse.json({
      ok: true,
      workspaces: workspaces?.length ?? 0,
      pending: pendingCount,
      sent,
      skipped,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron failed" },
      { status: 500 },
    );
  }
}
