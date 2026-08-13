import { Topbar } from "@/components/shell/Topbar";
import { updateNotificationRule } from "@/lib/actions/notifications";
import { RULE_COPY } from "@/lib/notifications/copy";
import type { NotificationRuleType } from "@/lib/notifications/types";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/format";
import { getSessionContext } from "@/lib/workspace";

const RULE_ORDER: NotificationRuleType[] = [
  "po_not_confirmed",
  "shipment_delayed",
  "arriving_soon",
  "inventory_low",
];

export default async function NotificationSettingsPage() {
  const { workspace } = await getSessionContext();
  const supabase = await createClient();
  const workspaceId = workspace!.id;
  const [{ data: rules }, { data: recentLog }] = await Promise.all([
    supabase
      .from("notification_rules")
      .select("id, rule_type, enabled, threshold_value")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    supabase
      .from("notification_log")
      .select("id, rule_type, po_id, dedupe_key, sent_at, recipient_email, purchase_orders(po_number)")
      .eq("workspace_id", workspaceId)
      .order("sent_at", { ascending: false })
      .limit(10),
  ]);

  const byType = new Map(
    (rules ?? []).map((rule) => [rule.rule_type as NotificationRuleType, rule]),
  );

  return (
    <>
      <Topbar
        title="Notifications"
        subline="Email alerts for PO state changes — no in-app inbox"
      />
      <div className="content stack" style={{ maxWidth: 720 }}>
        <div className="card">
          <div className="card-header">
            <h3>Email rules</h3>
          </div>
          <div className="card-body stack" style={{ gap: 18 }}>
            {RULE_ORDER.map((type) => {
              const rule = byType.get(type);
              const copy = RULE_COPY[type];
              if (!rule) {
                return (
                  <div key={type} className="small muted">
                    Missing rule: {type}. Re-run the notifications migration.
                  </div>
                );
              }

              return (
                <form
                  key={rule.id}
                  action={updateNotificationRule.bind(null, rule.id)}
                  className="stack"
                  style={{
                    gap: 10,
                    paddingBottom: 16,
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <div className="between" style={{ alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{copy.title}</div>
                      <div className="small muted">{copy.description}</div>
                    </div>
                    <label className="row" style={{ gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        name="enabled"
                        value="true"
                        defaultChecked={rule.enabled}
                      />
                      Enabled
                    </label>
                  </div>
                  {copy.thresholdLabel ? (
                    <div style={{ maxWidth: 200 }}>
                      <label className="field-label" htmlFor={`threshold-${rule.id}`}>
                        {copy.thresholdLabel}
                      </label>
                      <input
                        id={`threshold-${rule.id}`}
                        name="threshold_value"
                        type="number"
                        min={1}
                        className="field"
                        defaultValue={rule.threshold_value ?? ""}
                      />
                    </div>
                  ) : null}
                  <button type="submit" className="btn btn-secondary btn-sm">
                    Save rule
                  </button>
                </form>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Recent email log</h3>
          </div>
          {(recentLog?.length ?? 0) === 0 ? (
            <div className="card-body">
              <p className="small muted" style={{ margin: 0 }}>
                No notification emails sent yet. Cron runs{" "}
                <span className="mono">/api/cron/send-notifications</span> with
                your CRON_SECRET.
              </p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Rule</th>
                  <th>PO</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                {recentLog!.map((row) => {
                  const po = row.purchase_orders as unknown as {
                    po_number: string;
                  } | null;
                  const dedupe = (row as { dedupe_key?: string | null })
                    .dedupe_key;
                  const label =
                    po?.po_number ??
                    (row.rule_type === "inventory_low" ||
                    dedupe?.startsWith("inventory_low:")
                      ? "Low-stock SKU"
                      : "—");
                  return (
                    <tr key={row.id}>
                      <td className="small muted">
                        {relativeTime(row.sent_at)}
                      </td>
                      <td className="small">{row.rule_type}</td>
                      <td className="po-number">{label}</td>
                      <td className="small muted">{row.recipient_email}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
