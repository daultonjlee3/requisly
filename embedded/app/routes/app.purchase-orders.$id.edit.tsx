import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Banner, Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { CreatePoForm } from "../components/CreatePoForm";
import { getMerchantContext } from "../lib/merchant.server";
import {
  getPurchaseOrderDetail,
  loadNewPoFormData,
  updateOpenPurchaseOrder,
} from "../lib/purchase-orders.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: "auto" });
  const po = await getPurchaseOrderDetail(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!po) throw new Response("Not found", { status: 404 });
  if (!po.canEdit) {
    throw new Response("This purchase order cannot be edited", { status: 400 });
  }
  const formData = await loadNewPoFormData(
    merchant.workspace.id,
    po.supplier.id,
  );
  return {
    po,
    formData,
    workspaceName: merchant.workspace.name,
    syncError: merchant.syncError,
    shopName: merchant.shopName,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const poId = params.id ?? "";

  try {
    const lines = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    const result = await updateOpenPurchaseOrder({
      workspaceId: merchant.workspace.id,
      poId,
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
      actorLabel: merchant.shopName,
    });
    const qs = result.confirmationStale ? "?edited=1" : "";
    return merchant.redirect(`/app/purchase-orders/${poId}${qs}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to update PO",
    };
  }
};

export default function EditPurchaseOrder() {
  const { po, formData, syncError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const isDraft = po.status === "draft";

  return (
    <Page
      title={`Edit ${po.poNumber}`}
      subtitle={
        isDraft
          ? "Draft · not yet sent"
          : "Open PO · changes are logged; resend if already confirmed"
      }
      backAction={{
        content: po.poNumber,
        url: `/app/purchase-orders/${po.id}`,
      }}
    >
      <TitleBar title={`Edit ${po.poNumber}`} />
      {po.blanket ? (
        <Banner
          tone="info"
          title={`${po.blanket.blanketNumber} · ${po.blanket.remainingLabel} remaining`}
        >
          <p>
            This PO draws down against the blanket. Saving adjusts remaining
            quantity and value. Over-draw is blocked.
          </p>
        </Banner>
      ) : null}
      {!isDraft ? (
        <Banner tone="warning" title="Editing an open purchase order">
          <p>
            Changes are saved immediately and logged on the timeline. If the
            supplier already confirmed, their confirmation becomes stale until
            you resend and they confirm again.
          </p>
        </Banner>
      ) : null}
      {actionData?.error ? (
        <Banner tone="critical">
          <p>{actionData.error}</p>
        </Banner>
      ) : null}
      <CreatePoForm
        formData={formData}
        error={actionData?.error}
        syncError={syncError}
        lockSupplier
        showBlanketSelect={false}
        submitLabel="Save changes"
        initial={{
          supplierId: po.supplier.id,
          locationId: po.locationId,
          shipDate: po.requestedShipDateRaw,
          notes: po.notes ?? "",
          paymentTerms: po.paymentTerms ?? "",
          referenceNumber: po.referenceNumber ?? "",
          taxAmount: String(po.taxAmountRaw || ""),
          shippingAmount: String(po.shippingAmountRaw || ""),
          adjustmentAmount: String(po.adjustmentAmountRaw || ""),
          lines: po.lineItems.map((line) => ({
            key: line.id,
            description: line.description,
            sku: line.sku === "—" ? "" : line.sku,
            qty: line.qty,
            unitCost: String(line.unitCostRaw),
            isFreeText: line.isFreeText,
            supplierProductId: line.supplierProductId,
            shopifyVariantId: null,
            fromCatalogPrice: !line.isFreeText,
            costSource: !line.isFreeText ? ("catalog" as const) : ("manual" as const),
          })),
        }}
      />
    </Page>
  );
}
