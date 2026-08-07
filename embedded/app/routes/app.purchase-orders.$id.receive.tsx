import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Banner, Layout, Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ReceiveForm } from "../components/ReceiveForm";
import { getMerchantContext } from "../lib/merchant.server";
import { completeReceiving, loadReceiveForm } from "../lib/receiving.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await loadReceiveForm(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!form) {
    throw new Response("Purchase order not found", { status: 404 });
  }
  return { form };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const poId = params.id ?? "";
  const formData = await request.formData();

  try {
    const lines = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    await completeReceiving({
      workspaceId: merchant.workspace.id,
      poId,
      note: String(formData.get("note") ?? "").trim() || null,
      lines,
      admin: merchant.admin,
    });
    return merchant.redirect(`/app/purchase-orders/${poId}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to complete receipt",
    };
  }
};

export default function ReceivePurchaseOrder() {
  const { form } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const receivable = ["shipped", "in_transit", "partially_received"].includes(
    form.status,
  );

  return (
    <Page
      title={`Receive ${form.poNumber}`}
      subtitle={`${form.supplierName} · ${form.locationName}`}
      backAction={{
        content: form.poNumber,
        url: `/app/purchase-orders/${form.poId}`,
      }}
    >
      <TitleBar title={`Receive ${form.poNumber}`} />
      {!receivable ? (
        <Layout>
          <Layout.Section>
            <Banner tone="warning" title="Not ready to receive">
              <p>
                Receiving is available when the PO is shipped, in transit, or
                partially received. Current status: {form.status}.
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      ) : (
        <ReceiveForm lines={form.lines} error={actionData?.error} />
      )}
    </Page>
  );
}
