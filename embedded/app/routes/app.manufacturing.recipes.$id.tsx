import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  redirect,
  useActionData,
  useLoaderData,
} from "@remix-run/react";
import { Banner, Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { RecipeForm } from "../components/RecipeForm";
import { getMerchantContext } from "../lib/merchant.server";
import { getRecipe, upsertRecipe } from "../lib/manufacturing.server";
import { listShopifyVariantsForPicker } from "../lib/products.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const recipeId = String(params.id ?? "");
  const [recipe, variants] = await Promise.all([
    getRecipe(merchant.workspace.id, recipeId),
    listShopifyVariantsForPicker(merchant.workspace.id),
  ]);
  if (!recipe) throw new Response("Not found", { status: 404 });
  return { recipe, variants };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const recipeId = String(params.id ?? "");
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

  try {
    await upsertRecipe({
      workspaceId: merchant.workspace.id,
      recipeId,
      productVariantId,
      name,
      lines,
    });
    return redirect(`/app/manufacturing/recipes/${recipeId}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to save BOM",
    };
  }
};

export default function EditRecipePage() {
  const { recipe, variants } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page
      title={`BOM — ${recipe.finishedTitle}`}
      backAction={{ content: "BOMs", url: "/app/manufacturing/recipes" }}
    >
      <TitleBar title="Edit BOM" />
      {actionData && "error" in actionData && actionData.error ? (
        <Banner tone="critical" title="Save failed">
          <p>{actionData.error}</p>
        </Banner>
      ) : null}
      <RecipeForm
        variants={variants}
        recipeId={recipe.id}
        initialFinishedVariantId={recipe.productVariantId}
        initialName={recipe.name ?? ""}
        initialLines={recipe.lines.map((l) => ({
          key: l.id,
          ingredientProductVariantId: l.ingredientProductVariantId,
          title: l.title,
          qtyRequired: String(l.qtyRequired),
          isSubassembly: l.isSubassembly,
        }))}
        error={actionData && "error" in actionData ? actionData.error : null}
        submitLabel="Update BOM"
      />
    </Page>
  );
}
