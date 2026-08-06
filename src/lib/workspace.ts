import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  /** Session scoping: active workspace the user is viewing. */
  workspace_id: string;
  /** Signup / home workspace — not used for RLS or session scoping. */
  home_workspace_id: string;
  active_workspace_id: string;
  full_name: string | null;
  role: string;
};

export type Workspace = {
  id: string;
  name: string;
  is_demo?: boolean;
};

export type WorkspaceMembership = {
  workspace_id: string;
  role: string;
  name: string;
  is_demo: boolean;
};

export async function getSessionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      profile: null,
      workspace: null,
      memberships: [] as WorkspaceMembership[],
    };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, workspace_id, active_workspace_id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[getSessionContext] profile", profileError.message);
  }

  if (!profileRow) {
    return {
      user,
      profile: null,
      workspace: null,
      memberships: [] as WorkspaceMembership[],
    };
  }

  // Load memberships first — used both for the switcher and as a fallback
  // if the active workspace row is temporarily unreadable.
  const { data: memberRows, error: memberError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, is_demo)")
    .eq("profile_id", user.id)
    .not("joined_at", "is", null);

  if (memberError) {
    console.error("[getSessionContext] memberships", memberError.message);
  }

  const memberships: WorkspaceMembership[] = (memberRows ?? [])
    .map((row) => {
      const ws = row.workspaces as unknown as {
        id: string;
        name: string;
        is_demo: boolean | null;
      } | null;
      if (!ws) return null;
      return {
        workspace_id: row.workspace_id,
        role: row.role,
        name: ws.name,
        is_demo: Boolean(ws.is_demo),
      };
    })
    .filter((m): m is WorkspaceMembership => m != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  let activeId =
    profileRow.active_workspace_id ??
    profileRow.workspace_id ??
    memberships[0]?.workspace_id ??
    null;

  // If active points at a workspace we're not a member of, fall back.
  if (
    activeId &&
    memberships.length > 0 &&
    !memberships.some((m) => m.workspace_id === activeId)
  ) {
    activeId =
      memberships.find((m) => m.workspace_id === profileRow.workspace_id)
        ?.workspace_id ?? memberships[0]!.workspace_id;
  }

  let workspace: Workspace | null = null;
  if (activeId) {
    const { data: workspaceRow, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, name, is_demo")
      .eq("id", activeId)
      .maybeSingle();

    if (workspaceError) {
      console.error("[getSessionContext] workspace", workspaceError.message);
    }

    workspace = (workspaceRow as Workspace | null) ?? null;

    // Nested membership join already has workspace fields — use as fallback
    // when direct workspace SELECT is blocked or empty.
    if (!workspace) {
      const fromMembership = memberships.find((m) => m.workspace_id === activeId);
      if (fromMembership) {
        workspace = {
          id: fromMembership.workspace_id,
          name: fromMembership.name,
          is_demo: fromMembership.is_demo,
        };
      } else if (memberships[0]) {
        activeId = memberships[0].workspace_id;
        workspace = {
          id: memberships[0].workspace_id,
          name: memberships[0].name,
          is_demo: memberships[0].is_demo,
        };
      }
    }
  }

  if (!activeId || !workspace) {
    return {
      user,
      profile: null,
      workspace: null,
      memberships,
    };
  }

  const profile: Profile = {
    id: profileRow.id,
    workspace_id: activeId,
    home_workspace_id: profileRow.workspace_id,
    active_workspace_id: activeId,
    full_name: profileRow.full_name,
    role: profileRow.role,
  };

  return {
    user,
    profile,
    workspace,
    memberships,
  };
}

export function initials(name: string | null | undefined, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
