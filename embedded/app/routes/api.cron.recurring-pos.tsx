import type { LoaderFunctionArgs } from "@remix-run/node";
import { runDueRecurringTemplates } from "../lib/recurring-pos.server";

/**
 * Daily cron: draft POs from scheduled templates. Never sends.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id") ?? undefined;
  const today = url.searchParams.get("today") ?? undefined;

  try {
    const result = await runDueRecurringTemplates({ workspaceId, today });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Recurring PO cron failed",
      },
      { status: 500 },
    );
  }
};
