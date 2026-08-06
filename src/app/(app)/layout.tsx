import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { getSessionContext, initials } from "@/lib/workspace";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, workspace, memberships } = await getSessionContext();

  if (!user) {
    redirect("/login");
  }

  if (!profile || !workspace) {
    redirect("/login?error=profile");
  }

  const name = profile.full_name || user.email || "User";

  return (
    <div className="shell">
      <Sidebar
        fullName={name}
        workspaceName={workspace.name}
        activeWorkspaceId={profile.active_workspace_id}
        initials={initials(profile.full_name, user.email)}
        memberships={memberships}
      />
      <div className="main">{children}</div>
    </div>
  );
}
