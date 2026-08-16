import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { randomUUID } from "node:crypto";
import { TemplateForm } from "../components/TemplateForm";
import { getMerchantContext } from "../lib/merchant.server";
import {
  createPoTemplate,
  getPoTemplateDetail,
} from "../lib/po-templates.server";
import { parseScheduleFromForm } from "../lib/recurring-po";
import { DEFAULT_SCHEDULE } from "../lib/recurring-po";
import { loadNewPoFormData } from "../lib/purchase-orders.server";
import { createServiceClient } from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: "auto" });
  const url = new URL(request.url);
  const fromPoId = url.searchParams.get("from");
  const duplicateId = url.searchParams.get("duplicate");

  const catalog = await loadNewPoFormData(merchant.workspace.id);
  const suppliers = catalog.suppliers;
  const locations = catalog.locations;
  const supabase = createServiceClient();

  let initial: {
    name: string;
    description: string;
    supplierId: string;
    locationId: string;
    currency: string;
    notes: string;
    paymentTerms: string;
    status: "active";
    schedule: typeof DEFAULT_SCHEDULE;
    lines: Array<{
      key: string;
      description: string;
      sku: string;
      qty: string;
      unitCost: string;
      uom: string;
      supplierProductId: string | null;
    }>;
  } = {
    name: "",
    description: "",
    supplierId: "",
    locationId: locations[0]?.id ? String(locations[0].id) : "",
    currency: "USD",
    notes: "",
    paymentTerms: "",
    status: "active",
    schedule: DEFAULT_SCHEDULE,
    lines: [],
  };

  if (duplicateId) {
    const detail = await getPoTemplateDetail(
      merchant.workspace.id,
      duplicateId,
    );
    if (detail) {
      initial = {
        name: `${detail.name} (copy)`,
        description: detail.description ?? "",
        supplierId: detail.supplierId ?? "",
        locationId: detail.locationId ? String(detail.locationId) : "",
        currency: detail.currency,
        notes: detail.notes ?? "",
        paymentTerms: detail.paymentTerms ?? "",
        status: "active",
        schedule: { ...detail.schedule, enabled: false },
        lines: detail.lines.map((line) => ({
          key: randomUUID(),
          description: line.description,
          sku: line.sku,
          qty: line.qty,
          unitCost: line.unitCost,
          uom: line.uom,
          supplierProductId: line.supplierProductId,
        })),
      };
    }
  } else if (fromPoId) {
    const { data: po } = await supabase
      .from("purchase_orders")
      .select(
        "po_number, supplier_id, location_id, notes, payment_terms, po_line_items(description, sku, qty, unit_cost, supplier_product_id, is_free_text, sort_order)",
      )
      .eq("id", fromPoId)
      .eq("workspace_id", merchant.workspace.id)
      .maybeSingle();
    if (po) {
      const lines = (
        (po.po_line_items ?? []) as Array<{
          description: string;
          sku: string | null;
          qty: number;
          unit_cost: number;
          supplier_product_id: string | null;
          is_free_text: boolean;
          sort_order: number;
        }>
      ).sort((a, b) => a.sort_order - b.sort_order);
      initial = {
        name: `From ${po.po_number}`,
        description: `Created from purchase order ${po.po_number}`,
        supplierId: po.supplier_id ? String(po.supplier_id) : "",
        locationId: po.location_id ? String(po.location_id) : "",
        currency: "USD",
        notes: po.notes ?? "",
        paymentTerms: po.payment_terms ?? "",
        status: "active",
        schedule: DEFAULT_SCHEDULE,
        lines: lines.map((line) => ({
          key: randomUUID(),
          description: line.description,
          sku: line.sku ?? "",
          qty: String(line.qty),
          unitCost: String(line.unit_cost),
          uom: "",
          supplierProductId: line.is_free_text
            ? null
            : line.supplier_product_id,
        })),
      };
    }
  }

  return {
    suppliers: suppliers.map((s) => ({
      id: String(s.id),
      name: String(s.name),
    })),
    locations: locations.map((l) => ({
      id: String(l.id),
      name: String(l.name),
    })),
    shopifyVariants: catalog.shopifyVariants,
    catalogProducts: catalog.products,
    priorCosts: catalog.priorCosts,
    initial,
    fromPoId,
    sourcePoId: fromPoId,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();

  try {
    const lines = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    const created = await createPoTemplate({
      workspaceId: merchant.workspace.id,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      supplierId: String(formData.get("supplier_id") ?? "") || null,
      locationId: String(formData.get("location_id") ?? "") || null,
      currency: String(formData.get("currency") ?? "USD"),
      notes: String(formData.get("notes") ?? ""),
      paymentTerms: String(formData.get("payment_terms") ?? ""),
      createdByLabel: merchant.shopName,
      sourcePoId: String(formData.get("source_po_id") ?? "") || null,
      lines,
      schedule: parseScheduleFromForm(formData),
    });
    return merchant.redirect(`/app/templates/${created.id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create template",
    };
  }
};

export default function NewTemplate() {
  const {
    suppliers,
    locations,
    shopifyVariants,
    catalogProducts,
    priorCosts,
    initial,
    fromPoId,
    sourcePoId,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page
      title={fromPoId ? "Save PO as template" : "New template"}
      backAction={{ content: "Templates", url: "/app/templates" }}
    >
      <TitleBar title="New template" />
      <TemplateForm
        suppliers={suppliers}
        locations={locations}
        shopifyVariants={shopifyVariants}
        catalogProducts={catalogProducts}
        priorCosts={priorCosts}
        initial={initial}
        error={actionData?.error}
        submitLabel="Create template"
        sourcePoId={sourcePoId}
      />
    </Page>
  );
}
