"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export async function switchWorkspace(workspaceId: string) {
  const { user } = await getSessionContext();
  if (!user) throw new Error("Not authenticated");

  const supabase = await createClient();

  // Defense in depth: membership check in app + RPC rejects non-members.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("profile_id", user.id)
    .eq("workspace_id", workspaceId)
    .not("joined_at", "is", null)
    .maybeSingle();

  if (!membership) {
    throw new Error("Not a member of that workspace");
  }

  const { error } = await supabase.rpc("switch_active_workspace", {
    p_workspace_id: workspaceId,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/", "layout");
}
