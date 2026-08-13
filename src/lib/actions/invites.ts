"use server";

import { createClient } from "@/lib/supabase/server";

export type InvitePreview = {
  email: string;
  role: string;
  workspaceName: string;
  invitedByLabel: string | null;
};

function mapInviteError(message: string): string {
  if (message.includes("invalid_token")) return "This invite link is invalid.";
  if (message.includes("invite_revoked")) return "This invite was revoked.";
  if (message.includes("invite_already_accepted"))
    return "This invite was already accepted.";
  if (message.includes("invite_email_mismatch"))
    return "Sign in with the email address this invite was sent to.";
  if (message.includes("Not authenticated"))
    return "Sign in to accept this invite.";
  return message;
}

export async function loadInvitePreview(
  token: string,
): Promise<{ preview: InvitePreview | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_workspace_invite", {
    p_token: token,
  });

  if (error) {
    return { preview: null, error: mapInviteError(error.message) };
  }

  const row = data as {
    email?: string;
    role?: string;
    workspace_name?: string;
    invited_by_label?: string | null;
  } | null;

  if (!row?.email || !row.workspace_name) {
    return { preview: null, error: "This invite link is invalid." };
  }

  return {
    preview: {
      email: row.email,
      role: row.role ?? "member",
      workspaceName: row.workspace_name,
      invitedByLabel: row.invited_by_label ?? null,
    },
    error: null,
  };
}

export async function acceptInvite(
  token: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Sign in to accept this invite." };
  }

  const { data, error } = await supabase.rpc("accept_workspace_invite", {
    p_token: token,
  });

  if (error) {
    return { ok: false, error: mapInviteError(error.message) };
  }

  return { ok: true, workspaceId: data as string };
}
