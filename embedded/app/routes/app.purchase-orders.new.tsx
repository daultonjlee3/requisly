import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Banner, BlockStack, Layout, Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { CreatePoForm } from "../components/CreatePoForm";
import { StartFromTemplate } from "../components/StartFromTemplate";
import { getMerchantContext } from "../lib/merchant.server";
import { getBlanketDetail } from "../lib/blanket-pos.server";
import {
  createPurchaseOrder,
  loadNewPoFormData,
} from "../lib/purchase-orders.server";
import {
  listTemplatePickerSuggestions,
  recordTemplateUse,
  templateToCreatePoInitial,
} from "../lib/po-templates.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { startTimer } = await import("../lib/timing.server");
  const timer = startTimer("loader:/app/purchase-orders/new");
  const merchant = await getMerchantContext(request, { sync: "auto" });
  const url = new URL(request.url);
  const templateId = url.searchParams.get("template");
  const blanketId = url.searchParams.get("blanket");
  const formData = await loadNewPoFormData(
    merchant.workspace.id,
    url.searchParams.get("supplier"),
  );
  const templateSuggestions = await listTemplatePickerSuggestions(
    merchant.workspace.id,
  );
  let initial = templateId
    ? await templateToCreatePoInitial(merchant.workspace.id, templateId)
    : null;
  if (blanketId) {
    const blanket = await getBlanketDetail(merchant.workspace.id, blanketId);
    if (blanket) {
      initial = {
        ...(initial ?? {}),
        supplierId: blanket.supplierId,
        blanketPoId: blanket.id,
      };
    }
  }

  timer.end({ catalogSyncPending: merchant.catalogSyncPending });

  return {
    workspaceName: merchant.workspace.name,
    formData,
    syncError: merchant.syncError,
    catalogSyncPending: merchant.catalogSyncPending,
    templateSuggestions,
    initial,
    activeTemplateId: templateId,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();

  try {
    const lines = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    const templateId = String(formData.get("template_id") ?? "").trim();
    const po = await createPurchaseOrder({
      workspaceId: merchant.workspace.id,
      supplierId: String(formData.get("supplier_id") ?? ""),
      locationId: String(formData.get("location_id") ?? "") || null,
      requestedShipDate:
        String(formData.get("requested_ship_date") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      paymentTerms:
        String(formData.get("payment_terms") ?? "").trim() || null,
      referenceNumber:
        String(formData.get("reference_number") ?? "").trim() || null,
      taxAmount: Number(formData.get("tax_amount") ?? 0) || 0,
      shippingAmount: Number(formData.get("shipping_amount") ?? 0) || 0,
        adjustmentAmount: Number(formData.get("adjustment_amount") ?? 0) || 0,
      lines,
      sourceTemplateId: templateId || null,
      blanketPoId: String(formData.get("blanket_po_id") ?? "").trim() || null,
    });
    if (templateId) {
      await recordTemplateUse(merchant.workspace.id, templateId);
    }
    return merchant.redirect(`/app/purchase-orders/${po.id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create PO",
    };
  }
};

export default function NewPurchaseOrder() {
  const {
    workspaceName,
    formData,
    syncError,
    catalogSyncPending,
    templateSuggestions,
    initial,
    activeTemplateId,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (!formData.suppliers.length) {
    return (
      <Page
        title="New purchase order"
        backAction={{ content: "Purchase orders", url: "/app/purchase-orders" }}
      >
        <TitleBar title="New PO" />
        <Layout>
          <Layout.Section>
            <Banner
              tone="warning"
              title="Add a supplier first"
              action={{ content: "Add supplier", url: "/app/suppliers/new" }}
            >
              <p>
                {workspaceName} needs at least one supplier before you can draft
                a purchase order.
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!formData.locations.length) {
    return (
      <Page
        title="New purchase order"
        backAction={{ content: "Purchase orders", url: "/app/purchase-orders" }}
      >
        <TitleBar title="New PO" />
        <Layout>
          <Layout.Section>
            <Banner tone="warning" title="No ship-to locations">
              <p>
                Sync the Shopify catalog so locations are available, then try
                again.
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="New purchase order"
      subtitle={
        activeTemplateId
          ? `${workspaceName} · from template · review & send`
          : `${workspaceName} · draft · not yet sent`
      }
      backAction={{ content: "Purchase orders", url: "/app/purchase-orders" }}
      secondaryActions={[{ content: "Templates", url: "/app/templates" }]}
    >
      <TitleBar title="New PO" />
      <BlockStack gap="400">
        <StartFromTemplate
          recent={templateSuggestions.recent}
          mostUsed={templateSuggestions.mostUsed}
          recentlyUsed={templateSuggestions.recentlyUsed}
          activeTemplateId={activeTemplateId}
        />
        {activeTemplateId && !initial ? (
          <Banner tone="warning" title="Template unavailable">
            <p>
              That template was archived or deleted. Pick another, or build the
              PO from scratch below.
            </p>
          </Banner>
        ) : null}
        <CreatePoForm
          key={activeTemplateId ?? "blank"}
          formData={formData}
          error={actionData?.error}
          syncError={syncError}
          catalogSyncPending={catalogSyncPending}
          initial={initial ?? undefined}
          templateId={activeTemplateId}
        />
      </BlockStack>
    </Page>
  );
}
