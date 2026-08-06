"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export async function createSupplierProduct(formData: FormData) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const title = String(formData.get("title") ?? "").trim();
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!title) throw new Error("Title is required");
  if (!supplierId) throw new Error("Supplier is required");

  const sku = emptyToNull(formData.get("sku"));
  const unitCostRaw = String(formData.get("unit_cost") ?? "").trim();
  const caseQtyRaw = String(formData.get("case_qty") ?? "").trim();
  const moqRaw = String(formData.get("moq") ?? "").trim();
  const effectiveRaw = String(formData.get("effective_date") ?? "").trim();

  const unit_cost =
    unitCostRaw === "" ? null : Number(unitCostRaw.replace(/[^0-9.-]/g, ""));
  const case_qty = caseQtyRaw === "" ? null : Number.parseInt(caseQtyRaw, 10);
  const moq = moqRaw === "" ? null : Number.parseInt(moqRaw, 10);

  if (unit_cost != null && !Number.isFinite(unit_cost)) {
    throw new Error("Unit cost must be a number");
  }
  if (unit_cost != null && unit_cost < 0) {
    throw new Error("Unit cost cannot be negative");
  }
  if (case_qty != null && (!Number.isFinite(case_qty) || case_qty < 1)) {
    throw new Error("Case quantity must be a positive whole number");
  }
  if (moq != null && (!Number.isFinite(moq) || moq < 1)) {
    throw new Error("MOQ must be a positive whole number");
  }
  if (unit_cost != null && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveRaw)) {
    throw new Error("Effective date is required when setting a unit cost");
  }

  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("workspace_id", profile.workspace_id)
    .maybeSingle();

  if (!supplier) throw new Error("Supplier not found in this workspace");

  // unit_cost on supplier_products is deprecated — still set for backcompat
  // mirrors of the initial schedule row; reads must use supplier_product_pricing.
  const { data: product, error } = await supabase
    .from("supplier_products")
    .insert({
      workspace_id: profile.workspace_id,
      supplier_id: supplierId,
      product_variant_id: null,
      title,
      sku,
      unit_cost,
      case_qty,
      moq,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  if (unit_cost != null) {
    const { error: priceError } = await supabase
      .from("supplier_product_prices")
      .insert({
        supplier_product_id: product.id,
        unit_cost,
        effective_date: effectiveRaw,
        created_by: profile.id,
      });
    if (priceError) throw new Error(priceError.message);
  }

  revalidatePath("/products");
  revalidatePath(`/products/${product.id}`);
  revalidatePath(`/suppliers/${supplierId}`);
  redirect(
    safeReturnPath(formData.get("return_to"), `/suppliers/${supplierId}?tab=products`),
  );
}

export async function scheduleSupplierProductPrice(formData: FormData) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const productId = String(formData.get("supplier_product_id") ?? "").trim();
  const unitCostRaw = String(formData.get("unit_cost") ?? "").trim();
  const effectiveRaw = String(formData.get("effective_date") ?? "").trim();

  if (!productId) throw new Error("Product is required");

  const unit_cost = Number(unitCostRaw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(unit_cost) || unit_cost < 0) {
    throw new Error("Unit cost must be a non-negative number");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveRaw)) {
    throw new Error("Effective date is required");
  }

  const supabase = await createClient();

  const { data: product } = await supabase
    .from("supplier_products")
    .select("id, supplier_id, workspace_id")
    .eq("id", productId)
    .eq("workspace_id", profile.workspace_id)
    .maybeSingle();

  if (!product) throw new Error("Product not found in this workspace");

  const { error } = await supabase.from("supplier_product_prices").insert({
    supplier_product_id: product.id,
    unit_cost,
    effective_date: effectiveRaw,
    created_by: profile.id,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/products");
  revalidatePath(`/products/${product.id}`);
  revalidatePath(`/suppliers/${product.supplier_id}`);
  redirect(
    safeReturnPath(formData.get("return_to"), `/products/${product.id}`),
  );
}

export async function deleteSupplierProductPrice(priceId: string) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");
  if (!priceId) throw new Error("Price entry is required");

  const supabase = await createClient();

  const { data: price } = await supabase
    .from("supplier_product_prices")
    .select("id, supplier_product_id")
    .eq("id", priceId)
    .maybeSingle();

  if (!price) throw new Error("Price entry not found");

  const { data: product } = await supabase
    .from("supplier_products")
    .select("id, supplier_id, workspace_id")
    .eq("id", price.supplier_product_id)
    .eq("workspace_id", profile.workspace_id)
    .maybeSingle();

  if (!product) throw new Error("Price entry not found in this workspace");

  const { error } = await supabase
    .from("supplier_product_prices")
    .delete()
    .eq("id", priceId);

  if (error) throw new Error(error.message);

  revalidatePath("/products");
  revalidatePath(`/products/${product.id}`);
  revalidatePath(`/suppliers/${product.supplier_id}`);
}

function emptyToNull(value: FormDataEntryValue | null) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

/** Only allow in-app relative paths (blocks open redirects). */
function safeReturnPath(
  raw: FormDataEntryValue | null,
  fallback: string,
): string {
  const path = String(raw ?? "").trim();
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (!path.startsWith("/products") && !path.startsWith("/suppliers")) {
    return fallback;
  }
  return path;
}
