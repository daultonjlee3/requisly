import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { getMerchantContext } from "../lib/merchant.server";
import { createRecurringFromCadenceInsight } from "../lib/recurring-pos.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  return merchant.redirect("/app/templates");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const insightId = String(form.get("insightId") ?? "");
  if (!insightId) {
    return merchant.redirect("/app");
  }

  try {
    const result = await createRecurringFromCadenceInsight({
      workspaceId: merchant.workspace.id,
      insightId,
      createdByLabel: merchant.shopName,
    });
    const q = result.created ? "from_cadence=1" : "existing_recurring=1";
    return merchant.redirect(`/app/templates/${result.templateId}?${q}`);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not create recurring PO";
    return merchant.redirect(
      `/app?recurring_error=${encodeURIComponent(message)}`,
    );
  }
};
