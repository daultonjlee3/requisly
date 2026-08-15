import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect, useActionData, useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { RecipeForm } from "../components/RecipeForm";
import { getMerchantContext } from "../lib/merchant.server";
import { upsertRecipe } from "../lib/manufacturing.server";
import { listShopifyVariantsForPicker } from "../lib/products.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const variants = await listShopifyVariantsForPicker(merchant.workspace.id);
  return { variants };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const productVariantId = String(form.get("productVariantId") ?? "").trim();
  const name = String(form.get("name") ?? "").trim() || null;
  let lines: Array<{
    ingredientProductVariantId: string;
    qtyRequired: number;
    isSubassembly?: boolean;
  }> = [];
  try {
    lines = JSON.parse(String(form.get("lines_json") ?? "[]"));
  } catch {
    return { error: "Invalid ingredient payload" };
  }
  if (!productVariantId) return { error: "Select a finished product" };

  try {
    const { id } = await upsertRecipe({
      workspaceId: merchant.workspace.id,
      productVariantId,
      name,
      lines,
    });
    return redirect(`/app/manufacturing/recipes/${id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to save BOM",
    };
  }
};

export default function NewRecipePage() {
  const { variants } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page
      title="New bill of materials"
      backAction={{ content: "BOMs", url: "/app/manufacturing/recipes" }}
    >
      <TitleBar title="New BOM" />
      <RecipeForm
        variants={variants}
        error={actionData && "error" in actionData ? actionData.error : null}
      />
    </Page>
  );
}
