import type { SupabaseClient } from "@supabase/supabase-js";
import type { PendingNotification } from "@/lib/notifications/types";

export async function sendPendingNotifications(
  admin: SupabaseClient,
  pending: PendingNotification[],
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "Requisly <notifications@requisly.app>";

  if (!resendKey) {
    return {
      sent: 0,
      skipped: pending.length,
      errors: [
        "RESEND_API_KEY is not set — notifications evaluated but not emailed.",
      ],
    };
  }

  let sent = 0;
  const errors: string[] = [];

  for (const item of pending) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [item.recipient_email],
          subject: item.subject,
          text: item.body,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        errors.push(`${item.po_number}/${item.rule_type}: ${detail}`);
        continue;
      }

      const { error: logError } = await admin.from("notification_log").insert({
        workspace_id: item.workspace_id,
        rule_type: item.rule_type,
        po_id: item.po_id,
        dedupe_key: item.dedupe_key ?? null,
        recipient_email: item.recipient_email,
      });

      if (logError) {
        errors.push(`${item.po_number} log: ${logError.message}`);
        continue;
      }

      sent += 1;
    } catch (e) {
      errors.push(
        `${item.po_number}: ${e instanceof Error ? e.message : "send failed"}`,
      );
    }
  }

  return { sent, skipped: 0, errors };
}
