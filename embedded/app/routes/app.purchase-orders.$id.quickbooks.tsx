import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Banner, Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { QuickBooksPushPreview } from "../components/QuickBooksPushPreview";
import { getMerchantContext } from "../lib/merchant.server";
import {
  confirmQboPush,
  loadQboPushPreview,
} from "../lib/quickbooks-push.server";
import { QboReconnectNeededError } from "../lib/quickbooks.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const preview = await loadQboPushPreview(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!preview) {
    throw new Response("Purchase order not found", { status: 404 });
  }
  return { preview };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const poId = params.id ?? "";
  const form = await request.formData();
  try {
    const result = await confirmQboPush({
      workspaceId: merchant.workspace.id,
      poId,
      acknowledgeDiscrepancy:
        String(form.get("acknowledge_discrepancy") ?? "") === "true",
      force: String(form.get("force") ?? "") === "true",
      vendorChoice: String(form.get("vendor_choice") ?? "existing") as
        | "mapped"
        | "existing"
        | "create",
      vendorId: String(form.get("vendor_id") ?? ""),
      defaultAccountId: String(form.get("default_account_id") ?? ""),
      linesJson: String(form.get("lines_json") ?? "[]"),
    });
    return merchant.redirect(
      `/app/purchase-orders/${poId}?qb=1${result.billId ? `&bill=${encodeURIComponent(result.billId)}` : ""}`,
    );
  } catch (err) {
    const message =
      err instanceof QboReconnectNeededError
        ? err.message
        : err instanceof Error
          ? err.message
          : "QuickBooks push failed.";
    return { error: message };
  }
};

export default function PurchaseOrderQuickBooksPush() {
  const { preview } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page
      title={`Push ${preview.po.poNumber} to QuickBooks`}
      subtitle={preview.po.supplierName}
      backAction={{
        content: preview.po.poNumber,
        url: `/app/purchase-orders/${preview.po.id}`,
      }}
    >
      <TitleBar title={`Push ${preview.po.poNumber} to QuickBooks`} />
      {!preview.gate.ok && !preview.gate.alreadySynced ? (
        <Banner tone="warning" title="Not ready to push">
          <p>{preview.gate.reason}</p>
        </Banner>
      ) : null}
      <QuickBooksPushPreview preview={preview} error={actionData?.error} />
    </Page>
  );
}
