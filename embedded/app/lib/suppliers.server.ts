import { createServiceClient } from "./supabase.server";
import { money, relativeTime, shortDate } from "./format";
import { statusBadgeTone, statusLabel, type PoStatus } from "./po-status";
import { currentLandedUnitCostAsOf, todayDateInputValue } from "./pricing";

export type SupplierListItem = {
  id: string;
  name: string;
  email: string;
  openOrders: number;
  createdAt: string;
};

export type SupplierContact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
};

export type SupplierDetail = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  contactName: string | null;
  paymentTerms: string | null;
  notes: string | null;
  contacts: SupplierContact[];
  orders: Array<{
    id: string;
    poNumber: string;
    status: PoStatus;
    statusLabel: string;
    statusTone: ReturnType<typeof statusBadgeTone>;
    total: string;
    shipDate: string;
    updated: string;
  }>;
  products: Array<{
    id: string;
    title: string;
    sku: string;
    unitCost: string;
    caseQty: string;
    moq: string;
    shopifyVariantId: string | null;
  }>;
};

function emptyToNull(value: FormDataEntryValue | null) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

function requireEmail(value: FormDataEntryValue | null, label = "Email") {
  const email = String(value ?? "").trim();
  if (!email) throw new Error(`${label} is required`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${label} looks invalid`);
  }
  return email;
}

async function mirrorPrimaryContact(
  workspaceId: string,
  supplierId: string,
  contact: { name: string; email: string; phone: string | null },
) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("suppliers")
    .update({
      email: contact.email,
      contact_name: contact.name,
      phone: contact.phone,
    })
    .eq("id", supplierId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

async function clearOtherPrimaries(
  workspaceId: string,
  supplierId: string,
  exceptId?: string,
) {
  const supabase = createServiceClient();
  let query = supabase
    .from("supplier_contacts")
    .update({ is_primary: false })
    .eq("workspace_id", workspaceId)
    .eq("supplier_id", supplierId)
    .eq("is_primary", true);
  if (exceptId) query = query.neq("id", exceptId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function listSuppliers(
  workspaceId: string,
): Promise<SupplierListItem[]> {
  const supabase = createServiceClient();
  const [{ data: suppliers, error }, { data: pos, error: poErr }] =
    await Promise.all([
      supabase
        .from("suppliers")
        .select("id, name, email, created_at")
        .eq("workspace_id", workspaceId)
        .order("name"),
      supabase
        .from("purchase_orders")
        .select("supplier_id, status")
        .eq("workspace_id", workspaceId),
    ]);
  if (error) throw new Error(error.message);
  if (poErr) throw new Error(poErr.message);

  const openBySupplier = new Map<string, number>();
  for (const po of pos ?? []) {
    if (po.status === "draft" || po.status === "closed") continue;
    openBySupplier.set(
      po.supplier_id,
      (openBySupplier.get(po.supplier_id) ?? 0) + 1,
    );
  }

  return (suppliers ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    openOrders: openBySupplier.get(s.id) ?? 0,
    createdAt: shortDate(s.created_at),
  }));
}

export async function getSupplierDetail(
  workspaceId: string,
  supplierId: string,
): Promise<SupplierDetail | null> {
  const supabase = createServiceClient();
  const asOf = todayDateInputValue();

  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", supplierId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!supplier) return null;

  const [{ data: orders }, { data: products }, { data: contacts, error: cErr }] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select(
          "id, po_number, status, total, requested_ship_date, updated_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("supplier_id", supplierId)
        .order("created_at", { ascending: false }),
      supabase
        .from("supplier_products")
        .select(
          "id, title, sku, case_qty, moq, product_variants(shopify_variant_id), supplier_product_prices(id, unit_cost, freight_per_unit, duty_per_unit, customs_per_unit, landed_unit_cost, effective_date, created_at)",
        )
        .eq("workspace_id", workspaceId)
        .eq("supplier_id", supplierId)
        .order("title"),
      supabase
        .from("supplier_contacts")
        .select("id, name, email, phone, title, is_primary")
        .eq("workspace_id", workspaceId)
        .eq("supplier_id", supplierId)
        .order("is_primary", { ascending: false })
        .order("name"),
    ]);
  if (cErr) throw new Error(cErr.message);

  return {
    id: supplier.id,
    name: supplier.name,
    email: supplier.email,
    phone: supplier.phone,
    contactName: supplier.contact_name,
    paymentTerms: supplier.payment_terms,
    notes: supplier.notes,
    contacts: (contacts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      title: c.title,
      isPrimary: Boolean(c.is_primary),
    })),
    orders: (orders ?? []).map((po) => {
      const status = po.status as PoStatus;
      return {
        id: po.id,
        poNumber: po.po_number,
        status,
        statusLabel: statusLabel(status),
        statusTone: statusBadgeTone(status),
        total: money(po.total),
        shipDate: shortDate(po.requested_ship_date),
        updated: relativeTime(po.updated_at),
      };
    }),
    products: (products ?? []).map((p) => {
      const prices = (p.supplier_product_prices ?? []) as Array<{
        id: string;
        unit_cost: number | string;
        freight_per_unit?: number | string | null;
        duty_per_unit?: number | string | null;
        customs_per_unit?: number | string | null;
        landed_unit_cost?: number | string | null;
        effective_date: string;
        created_at: string;
      }>;
      const variant = p.product_variants as unknown as {
        shopify_variant_id: string;
      } | null;
      const cost = currentLandedUnitCostAsOf(prices, asOf);
      return {
        id: p.id,
        title: p.title,
        sku: p.sku || "—",
        unitCost: cost != null ? money(cost) : "—",
        caseQty: p.case_qty != null ? String(p.case_qty) : "—",
        moq: p.moq != null ? String(p.moq) : "—",
        shopifyVariantId: variant?.shopify_variant_id ?? null,
      };
    }),
  };
}

export async function createSupplier(
  workspaceId: string,
  formData: FormData,
): Promise<{ id: string }> {
  const name = String(formData.get("name") ?? "").trim();
  const email = requireEmail(formData.get("email"));
  if (!name) throw new Error("Name is required");

  const contactName =
    emptyToNull(formData.get("contact_name")) ?? name;
  const phone = emptyToNull(formData.get("phone"));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      workspace_id: workspaceId,
      name,
      email,
      phone,
      contact_name: contactName,
      payment_terms: emptyToNull(formData.get("payment_terms")),
      notes: emptyToNull(formData.get("notes")),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: contactErr } = await supabase.from("supplier_contacts").insert({
    workspace_id: workspaceId,
    supplier_id: data.id,
    name: contactName,
    email,
    phone,
    title: emptyToNull(formData.get("contact_title")),
    is_primary: true,
  });
  if (contactErr) throw new Error(contactErr.message);

  return { id: data.id };
}

export async function updateSupplier(
  workspaceId: string,
  supplierId: string,
  formData: FormData,
): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("suppliers")
    .update({
      name,
      payment_terms: emptyToNull(formData.get("payment_terms")),
      notes: emptyToNull(formData.get("notes")),
    })
    .eq("id", supplierId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function addSupplierContact(
  workspaceId: string,
  supplierId: string,
  formData: FormData,
): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const email = requireEmail(formData.get("email"));
  if (!name) throw new Error("Contact name is required");

  const phone = emptyToNull(formData.get("phone"));
  const title = emptyToNull(formData.get("title"));
  const makePrimary = String(formData.get("is_primary") ?? "") === "true";

  const supabase = createServiceClient();
  const { count, error: countErr } = await supabase
    .from("supplier_contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("supplier_id", supplierId);
  if (countErr) throw new Error(countErr.message);

  const isPrimary = makePrimary || (count ?? 0) === 0;
  if (isPrimary) {
    await clearOtherPrimaries(workspaceId, supplierId);
  }

  const { error } = await supabase.from("supplier_contacts").insert({
    workspace_id: workspaceId,
    supplier_id: supplierId,
    name,
    email,
    phone,
    title,
    is_primary: isPrimary,
  });
  if (error) throw new Error(error.message);

  if (isPrimary) {
    await mirrorPrimaryContact(workspaceId, supplierId, {
      name,
      email,
      phone,
    });
  }
}

export async function updateSupplierContact(
  workspaceId: string,
  supplierId: string,
  formData: FormData,
): Promise<void> {
  const contactId = String(formData.get("contact_id") ?? "").trim();
  if (!contactId) throw new Error("Contact id is required");

  const name = String(formData.get("name") ?? "").trim();
  const email = requireEmail(formData.get("email"));
  if (!name) throw new Error("Contact name is required");

  const phone = emptyToNull(formData.get("phone"));
  const title = emptyToNull(formData.get("title"));
  const makePrimary = String(formData.get("is_primary") ?? "") === "true";

  const supabase = createServiceClient();
  const { data: existing, error: existingErr } = await supabase
    .from("supplier_contacts")
    .select("id, is_primary")
    .eq("id", contactId)
    .eq("supplier_id", supplierId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);
  if (!existing) throw new Error("Contact not found");

  const isPrimary = makePrimary || Boolean(existing.is_primary);
  if (isPrimary) {
    await clearOtherPrimaries(workspaceId, supplierId, contactId);
  }

  const { error } = await supabase
    .from("supplier_contacts")
    .update({
      name,
      email,
      phone,
      title,
      is_primary: isPrimary,
    })
    .eq("id", contactId)
    .eq("supplier_id", supplierId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  if (isPrimary) {
    await mirrorPrimaryContact(workspaceId, supplierId, {
      name,
      email,
      phone,
    });
  }
}

export async function setPrimarySupplierContact(
  workspaceId: string,
  supplierId: string,
  contactId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data: contact, error } = await supabase
    .from("supplier_contacts")
    .select("id, name, email, phone")
    .eq("id", contactId)
    .eq("supplier_id", supplierId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!contact) throw new Error("Contact not found");

  await clearOtherPrimaries(workspaceId, supplierId, contactId);
  const { error: updateErr } = await supabase
    .from("supplier_contacts")
    .update({ is_primary: true })
    .eq("id", contactId)
    .eq("workspace_id", workspaceId);
  if (updateErr) throw new Error(updateErr.message);

  await mirrorPrimaryContact(workspaceId, supplierId, {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
  });
}

export async function deleteSupplierContact(
  workspaceId: string,
  supplierId: string,
  contactId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data: contact, error } = await supabase
    .from("supplier_contacts")
    .select("id, is_primary")
    .eq("id", contactId)
    .eq("supplier_id", supplierId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!contact) throw new Error("Contact not found");

  const { count, error: countErr } = await supabase
    .from("supplier_contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("supplier_id", supplierId);
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) <= 1) {
    throw new Error("Keep at least one contact on the supplier");
  }

  const { error: deleteErr } = await supabase
    .from("supplier_contacts")
    .delete()
    .eq("id", contactId)
    .eq("workspace_id", workspaceId);
  if (deleteErr) throw new Error(deleteErr.message);

  if (contact.is_primary) {
    const { data: next, error: nextErr } = await supabase
      .from("supplier_contacts")
      .select("id, name, email, phone")
      .eq("workspace_id", workspaceId)
      .eq("supplier_id", supplierId)
      .order("name")
      .limit(1)
      .maybeSingle();
    if (nextErr) throw new Error(nextErr.message);
    if (next) {
      await setPrimarySupplierContact(workspaceId, supplierId, next.id);
    }
  }
}
