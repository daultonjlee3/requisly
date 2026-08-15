/**
 * Smoke test: team invite create + Resend + get_workspace_invite RPC.
 * Usage: npx tsx scripts/smoke-team-invite.ts [email]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv(resolve("embedded/.env"));
loadEnv(resolve(".env.local"));
loadEnv(resolve(".env"));

const workspaceId =
  process.env.SMOKE_WORKSPACE_ID || "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

function emailFromFromHeader(raw: string | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle?.[1] || raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  // Don't deliver smoke mail to shared product inboxes.
  if (
    candidate.startsWith("notifications@") ||
    candidate.startsWith("noreply@") ||
    candidate.startsWith("no-reply@")
  ) {
    return null;
  }
  return candidate;
}

const toEmail =
  process.argv[2] ||
  process.env.AI_DIGEST_FALLBACK_EMAIL ||
  process.env.SMOKE_INVITE_EMAIL ||
  emailFromFromHeader(process.env.RESEND_FROM_EMAIL);

if (!toEmail) {
  console.error(
    "Pass an email: npx tsx scripts/smoke-team-invite.ts you@example.com",
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.RESEND_API_KEY;
const from =
  process.env.RESEND_FROM_EMAIL || "Requisly <orders@requisly.com>";
const appUrl = (
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"
).replace(/\/$/, "");

if (!url || !key) {
  console.error("Missing Supabase URL / service role key");
  process.exit(1);
}
if (!resendKey) {
  console.error("Missing RESEND_API_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const email = toEmail.trim().toLowerCase();
  const token = randomBytes(24).toString("base64url");

  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .single();
  if (wsErr) throw new Error(wsErr.message);

  // Revoke any prior pending smoke invites for this email so re-runs are clean.
  await supabase
    .from("workspace_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .ilike("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { data: invite, error: insErr } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email,
      role: "member",
      token,
      invited_by_label: "Smoke test",
    })
    .select("id, email, role, invited_at")
    .single();
  if (insErr) throw new Error(`insert: ${insErr.message}`);

  const inviteUrl = `${appUrl}/invite/${token}`;
  const subject = `Join ${ws.name} on Requisly`;
  const body = [
    `Smoke test invited you to ${ws.name} on Requisly.`,
    "",
    "Open this link to accept:",
    inviteUrl,
  ].join("\n");

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [email], subject, text: body }),
  });
  const resendText = await resendRes.text();
  let resendJson: { id?: string } | null = null;
  try {
    resendJson = JSON.parse(resendText);
  } catch {
    /* plain */
  }

  const { data: preview, error: previewErr } = await supabase.rpc(
    "get_workspace_invite",
    { p_token: token },
  );

  const results = {
    workspace: ws.name,
    inviteId: invite.id,
    inviteEmail: invite.email,
    inviteUrlHost: new URL(inviteUrl).host,
    inviteUrlPath: new URL(inviteUrl).pathname,
    resendOk: resendRes.ok,
    resendStatus: resendRes.status,
    resendId: resendJson?.id ?? null,
    resendError: resendRes.ok ? null : resendText.slice(0, 300),
    previewOk: !previewErr && Boolean(preview),
    previewError: previewErr?.message ?? null,
    previewWorkspace: (preview as { workspace_name?: string } | null)
      ?.workspace_name,
    previewEmail: (preview as { email?: string } | null)?.email,
  };

  console.log(JSON.stringify(results, null, 2));
  if (!results.resendOk || !results.previewOk) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

