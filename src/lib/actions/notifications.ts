"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export async function updateNotificationRule(
  ruleId: string,
  formData: FormData,
) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const thresholdRaw = String(formData.get("threshold_value") ?? "").trim();
  const threshold_value = thresholdRaw === "" ? null : Number(thresholdRaw);

  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_rules")
    .update({
      enabled,
      threshold_value: Number.isFinite(threshold_value as number)
        ? threshold_value
        : null,
    })
    .eq("id", ruleId)
    .eq("workspace_id", profile.workspace_id);

  if (error) throw new Error(error.message);

  revalidatePath("/settings/notifications");
}

export async function updatePoArrivalDate(poId: string, formData: FormData) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const estimated_arrival_date =
    String(formData.get("estimated_arrival_date") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ estimated_arrival_date })
    .eq("id", poId)
    .eq("workspace_id", profile.workspace_id);

  if (error) throw new Error(error.message);

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/");
}
