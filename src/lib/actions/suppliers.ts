"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export async function createSupplier(formData: FormData) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!name || !email) throw new Error("Name and email are required");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      workspace_id: profile.workspace_id,
      name,
      email,
      phone: emptyToNull(formData.get("phone")),
      contact_name: emptyToNull(formData.get("contact_name")),
      payment_terms: emptyToNull(formData.get("payment_terms")),
      notes: emptyToNull(formData.get("notes")),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/suppliers");
  redirect(`/suppliers/${data.id}`);
}

export async function updateSupplier(supplierId: string, formData: FormData) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!name || !email) throw new Error("Name and email are required");

  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({
      name,
      email,
      phone: emptyToNull(formData.get("phone")),
      contact_name: emptyToNull(formData.get("contact_name")),
      payment_terms: emptyToNull(formData.get("payment_terms")),
      notes: emptyToNull(formData.get("notes")),
    })
    .eq("id", supplierId)
    .eq("workspace_id", profile.workspace_id);

  if (error) throw new Error(error.message);

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  redirect(`/suppliers/${supplierId}`);
}

function emptyToNull(value: FormDataEntryValue | null) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}
