import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { CorrectReceiptForm } from "../components/CorrectReceiptForm";
import { getMerchantContext } from "../lib/merchant.server";
import {
  correctReceipt,
  loadReceiptCorrectionForm,
} from "../lib/receiving.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await loadReceiptCorrectionForm(
    merchant.workspace.id,
    params.id ?? "",
    params.receiptId ?? "",
  );
  if (!form) {
    throw new Response("Receipt not found", { status: 404 });
  }
  return { form };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const poId = params.id ?? "";
  const receiptId = params.receiptId ?? "";
  const formData = await request.formData();

  try {
    const lines = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    await correctReceipt({
      workspaceId: merchant.workspace.id,
      poId,
      receiptId,
      note: String(formData.get("note") ?? "").trim() || null,
      lines,
      admin: merchant.admin,
    });
    return merchant.redirect(`/app/purchase-orders/${poId}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to correct receipt",
    };
  }
};

export default function CorrectReceiptPage() {
  const { form } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page
      title={`Correct receipt · ${form.poNumber}`}
      subtitle={`${form.supplierName} · ${form.locationName}`}
      backAction={{
        content: form.poNumber,
        url: `/app/purchase-orders/${form.poId}`,
      }}
    >
      <TitleBar title={`Correct receipt · ${form.poNumber}`} />
      <CorrectReceiptForm
        lines={form.lines}
        note={form.note}
        error={actionData?.error}
      />
    </Page>
  );
}
