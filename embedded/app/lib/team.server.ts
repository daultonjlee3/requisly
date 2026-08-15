import { randomBytes } from "node:crypto";
import { createServiceClient } from "./supabase.server";

export type TeamMemberRow = {
  id: string;
  profileId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  joinedAt: string | null;
  status: "active" | "pending_member";
};

export type TeamInviteRow = {
  id: string;
  email: string;
  role: string;
  invitedAt: string;
  invitedByLabel: string | null;
  status: "pending" | "accepted" | "revoked";
};

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.SUPPLIER_LINK_BASE_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendInviteEmail(opts: {
  to: string;
  workspaceName: string;
  inviteUrl: string;
  invitedByLabel: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL || "Requisly <orders@requisly.com>";
  if (!resendKey) {
    return { sent: false, error: "RESEND_API_KEY is not set" };
  }

  const who = opts.invitedByLabel?.trim() || "Your teammate";
  const subject = `Join ${opts.workspaceName} on Requisly`;
  const body = [
    `${who} invited you to ${opts.workspaceName} on Requisly.`,
    "",
    "Open this link to accept (sign in or create an account with this email):",
    opts.inviteUrl,
    "",
    "If you weren’t expecting this, you can ignore the email.",
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject,
        text: body,
      }),
    });
    if (!response.ok) {
      return { sent: false, error: await response.text() };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

export async function loadTeamPage(workspaceId: string): Promise<{
  workspaceName: string;
  members: TeamMemberRow[];
  invites: TeamInviteRow[];
}> {
  const supabase = createServiceClient();

  const { data: workspace, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .single();
  if (wsErr) throw new Error(wsErr.message);

  const { data: memberRows, error: memberErr } = await supabase
    .from("workspace_members")
    .select("id, profile_id, role, joined_at, profiles(full_name)")
    .eq("workspace_id", workspaceId)
    .order("invited_at", { ascending: true });
  if (memberErr) throw new Error(memberErr.message);

  const members: TeamMemberRow[] = [];
  for (const row of memberRows ?? []) {
    const profile = row.profiles as unknown as { full_name: string | null } | null;
    let email: string | null = null;
    try {
      const { data } = await supabase.auth.admin.getUserById(row.profile_id);
      email = data.user?.email ?? null;
    } catch {
      /* ignore */
    }
    members.push({
      id: row.id,
      profileId: row.profile_id,
      fullName: profile?.full_name ?? null,
      email,
      role: row.role,
      joinedAt: row.joined_at,
      status: row.joined_at ? "active" : "pending_member",
    });
  }

  const { data: inviteRows, error: inviteErr } = await supabase
    .from("workspace_invites")
    .select(
      "id, email, role, invited_at, invited_by_label, accepted_at, revoked_at",
    )
    .eq("workspace_id", workspaceId)
    .order("invited_at", { ascending: false });
  if (inviteErr) throw new Error(inviteErr.message);

  const invites: TeamInviteRow[] = (inviteRows ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    invitedAt: row.invited_at,
    invitedByLabel: row.invited_by_label,
    status: row.revoked_at
      ? "revoked"
      : row.accepted_at
        ? "accepted"
        : "pending",
  }));

  return {
    workspaceName: workspace.name,
    members,
    invites,
  };
}

export async function inviteTeammate(opts: {
  workspaceId: string;
  email: string;
  invitedByLabel?: string | null;
}): Promise<{ inviteId: string; emailSent: boolean; emailError: string | null }> {
  const email = normalizeEmail(opts.email);
  if (!isValidEmail(email)) {
    throw new Error("Enter a valid email address");
  }

  const supabase = createServiceClient();

  const { data: workspace, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", opts.workspaceId)
    .single();
  if (wsErr) throw new Error(wsErr.message);

  // Already an active member with this email?
  const { data: existingMembers } = await supabase
    .from("workspace_members")
    .select("id, profile_id, joined_at")
    .eq("workspace_id", opts.workspaceId)
    .not("joined_at", "is", null);

  for (const m of existingMembers ?? []) {
    try {
      const { data } = await supabase.auth.admin.getUserById(m.profile_id);
      if (data.user?.email && normalizeEmail(data.user.email) === email) {
        throw new Error("That person is already a member of this workspace");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("already a member")) {
        throw err;
      }
    }
  }

  const { data: pending } = await supabase
    .from("workspace_invites")
    .select("id")
    .eq("workspace_id", opts.workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .ilike("email", email)
    .maybeSingle();
  if (pending) {
    throw new Error("An invite is already pending for that email");
  }

  const token = randomBytes(24).toString("base64url");
  const { data: created, error: createErr } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: opts.workspaceId,
      email,
      role: "member",
      token,
      invited_by_label: opts.invitedByLabel?.trim() || null,
    })
    .select("id")
    .single();
  if (createErr) throw new Error(createErr.message);

  const inviteUrl = `${appBaseUrl()}/invite/${token}`;
  const sendResult = await sendInviteEmail({
    to: email,
    workspaceName: workspace.name,
    inviteUrl,
    invitedByLabel: opts.invitedByLabel ?? null,
  });

  return {
    inviteId: created.id,
    emailSent: sendResult.sent,
    emailError: sendResult.error ?? null,
  };
}

export async function revokeInvite(opts: {
  workspaceId: string;
  inviteId: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workspace_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", opts.inviteId)
    .eq("workspace_id", opts.workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Invite not found or already closed");
}

export async function resendInvite(opts: {
  workspaceId: string;
  inviteId: string;
  invitedByLabel?: string | null;
}): Promise<{ emailSent: boolean; emailError: string | null }> {
  const supabase = createServiceClient();
  const { data: invite, error } = await supabase
    .from("workspace_invites")
    .select("id, email, token, invited_by_label")
    .eq("id", opts.inviteId)
    .eq("workspace_id", opts.workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invite) throw new Error("Invite not found or already closed");

  const { data: workspace, error: wsErr } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", opts.workspaceId)
    .single();
  if (wsErr) throw new Error(wsErr.message);

  const inviteUrl = `${appBaseUrl()}/invite/${invite.token}`;
  const sendResult = await sendInviteEmail({
    to: invite.email,
    workspaceName: workspace.name,
    inviteUrl,
    invitedByLabel:
      opts.invitedByLabel?.trim() || invite.invited_by_label || null,
  });

  return {
    emailSent: sendResult.sent,
    emailError: sendResult.error ?? null,
  };
}
