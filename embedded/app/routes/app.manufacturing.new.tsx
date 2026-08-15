import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Page,
  Select,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  createManufacturingOrder,
  listRecipes,
} from "../lib/manufacturing.server";
import { createServiceClient } from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const supabase = createServiceClient();
  const [recipes, { data: locations }] = await Promise.all([
    listRecipes(merchant.workspace.id),
    supabase
      .from("locations")
      .select("id, name, is_primary")
      .eq("workspace_id", merchant.workspace.id)
      .order("name"),
  ]);
  return {
    recipes,
    locations: (locations ?? []).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      isPrimary: Boolean(l.is_primary),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const productVariantId = String(form.get("productVariantId") ?? "").trim();
  const locationId = String(form.get("locationId") ?? "").trim();
  const qtyToMake = Number(form.get("qtyToMake"));
  const notes = String(form.get("notes") ?? "").trim() || null;

  try {
    const { id } = await createManufacturingOrder({
      workspaceId: merchant.workspace.id,
      productVariantId,
      locationId,
      qtyToMake,
      notes,
    });
    return redirect(`/app/manufacturing/${id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create MO",
    };
  }
};

export default function NewManufacturingOrderPage() {
  const { recipes, locations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const primary =
    locations.find((l) => l.isPrimary)?.id ?? locations[0]?.id ?? "";
  const [productVariantId, setProductVariantId] = useState(
    recipes[0]?.productVariantId ?? "",
  );
  const [locationId, setLocationId] = useState(primary);
  const [qtyToMake, setQtyToMake] = useState("1");
  const [notes, setNotes] = useState("");

  return (
    <Page
      title="New manufacturing order"
      backAction={{ content: "Manufacturing", url: "/app/manufacturing" }}
    >
      <TitleBar title="New MO" />
      <Form method="post">
        <input type="hidden" name="productVariantId" value={productVariantId} />
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="qtyToMake" value={qtyToMake} />
        <input type="hidden" name="notes" value={notes} />
        <BlockStack gap="400">
          {actionData?.error ? (
            <Banner tone="critical" title="Could not create MO">
              <p>{actionData.error}</p>
            </Banner>
          ) : null}
          {!recipes.length ? (
            <Banner tone="warning" title="No BOM yet">
              <p>
                Create a bill of materials before starting a manufacturing
                order.
              </p>
              <Button url="/app/manufacturing/recipes/new">Create BOM</Button>
            </Banner>
          ) : null}
          <Card>
            <FormLayout>
              <Select
                label="Finished product (must have a BOM)"
                options={recipes.map((r) => ({
                  label: r.finishedSku
                    ? `${r.finishedTitle} (${r.finishedSku})`
                    : r.finishedTitle,
                  value: r.productVariantId,
                }))}
                value={productVariantId}
                onChange={setProductVariantId}
                disabled={!recipes.length}
              />
              <Select
                label="Inventory location"
                options={locations.map((l) => ({
                  label: l.name,
                  value: l.id,
                }))}
                value={locationId}
                onChange={setLocationId}
                disabled={!locations.length}
              />
              <TextField
                label="Quantity to make"
                type="number"
                value={qtyToMake}
                onChange={setQtyToMake}
                autoComplete="off"
                min={1}
              />
              <TextField
                label="Notes"
                value={notes}
                onChange={setNotes}
                multiline={3}
                autoComplete="off"
              />
            </FormLayout>
          </Card>
          <Button
            submit
            variant="primary"
            loading={submitting}
            disabled={!recipes.length || !locations.length}
          >
            Create draft MO
          </Button>
        </BlockStack>
      </Form>
    </Page>
  );
}
