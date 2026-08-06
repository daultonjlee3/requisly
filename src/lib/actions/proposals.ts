"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export async function resolveProposal(proposalId: string, accept: boolean) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_line_item_proposal", {
    p_proposal_id: proposalId,
    p_accept: accept,
  });

  if (error) throw new Error(error.message);

  const poId = (data as { po_id?: string } | null)?.po_id;
  if (poId) {
    revalidatePath(`/purchase-orders/${poId}`);
    revalidatePath("/purchase-orders");
    revalidatePath("/");
  }

  return data;
}
