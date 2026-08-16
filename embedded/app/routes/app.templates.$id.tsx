import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { Banner, BlockStack, Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { TemplateForm } from "../components/TemplateForm";
import { getMerchantContext } from "../lib/merchant.server";
import {
  getPoTemplateDetail,
  updatePoTemplate,
  type TemplateStatus,
} from "../lib/po-templates.server";
import { parseScheduleFromForm } from "../lib/recurring-po";
import { loadNewPoFormData } from "../lib/purchase-orders.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: "auto" });
  const template = await getPoTemplateDetail(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!template) throw new Response("Not found", { status: 404 });

  const catalog = await loadNewPoFormData(merchant.workspace.id);

  return {
    template,
    suppliers: catalog.suppliers.map((s) => ({
      id: String(s.id),
      name: String(s.name),
    })),
    locations: catalog.locations.map((l) => ({
      id: String(l.id),
      name: String(l.name),
    })),
    shopifyVariants: catalog.shopifyVariants,
    catalogProducts: catalog.products,
    priorCosts: catalog.priorCosts,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const templateId = params.id ?? "";

  try {
    const lines = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    await updatePoTemplate({
      workspaceId: merchant.workspace.id,
      templateId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      supplierId: String(formData.get("supplier_id") ?? "") || null,
      locationId: String(formData.get("location_id") ?? "") || null,
      currency: String(formData.get("currency") ?? "USD"),
      notes: String(formData.get("notes") ?? ""),
      paymentTerms: String(formData.get("payment_terms") ?? ""),
      status: String(formData.get("status") ?? "active") as TemplateStatus,
      lines,
      schedule: parseScheduleFromForm(formData),
    });
    return merchant.redirect(`/app/templates/${templateId}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to save template",
    };
  }
};

export default function EditTemplate() {
  const {
    template,
    suppliers,
    locations,
    shopifyVariants,
    catalogProducts,
    priorCosts,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const fromCadence = searchParams.get("from_cadence") === "1";
  const existingRecurring = searchParams.get("existing_recurring") === "1";

  return (
    <Page
      title={template.name}
      subtitle={`${template.supplierName} · ${template.lastUsedLabel}${
        template.schedule.enabled ? ` · ${template.schedule.nextRunOn ? `Next draft ${template.schedule.nextRunOn}` : "Scheduled"}` : ""
      }`}
      backAction={{ content: "Templates", url: "/app/templates" }}
      primaryAction={{
        content: "Use template",
        url: `/app/purchase-orders/new?template=${template.id}`,
      }}
      secondaryActions={[
        {
          content: "Duplicate",
          url: `/app/templates/new?duplicate=${template.id}`,
        },
      ]}
    >
      <TitleBar title={template.name} />
      <BlockStack gap="400">
        {fromCadence ? (
          <Banner tone="success" title="Recurring PO created from cadence">
            <p>
              Review the lines and schedule. On the next draft date we will
              create a draft PO only — it will never be sent automatically.
            </p>
          </Banner>
        ) : null}
        {existingRecurring ? (
          <Banner tone="info" title="This supplier already has a recurring PO">
            <p>
              We opened the existing scheduled template instead of creating
              another.
            </p>
          </Banner>
        ) : null}
        <TemplateForm
        suppliers={suppliers}
        locations={locations}
        shopifyVariants={shopifyVariants}
        catalogProducts={catalogProducts}
        priorCosts={priorCosts}
        initial={{
          name: template.name,
          description: template.description ?? "",
          supplierId: template.supplierId ?? "",
          locationId: template.locationId ?? "",
          currency: template.currency,
          notes: template.notes ?? "",
          paymentTerms: template.paymentTerms ?? "",
          status: template.status,
          schedule: template.schedule,
          lines: template.lines.map((line) => ({
            key: line.id,
            description: line.description,
            sku: line.sku,
            qty: line.qty,
            unitCost: line.unitCost,
            uom: line.uom,
            supplierProductId: line.supplierProductId,
          })),
        }}
        error={actionData?.error}
        submitLabel="Save template"
        scheduleLastError={template.scheduleLastError}
      />
      </BlockStack>
    </Page>
  );
}
