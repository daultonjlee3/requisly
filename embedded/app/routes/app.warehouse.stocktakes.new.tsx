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
  createStocktake,
  listWorkspaceLocations,
} from "../lib/warehouse.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const locations = await listWorkspaceLocations(merchant.workspace.id);
  return { locations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  try {
    const { id } = await createStocktake({
      workspaceId: merchant.workspace.id,
      locationId: String(form.get("locationId") ?? ""),
      notes: String(form.get("notes") ?? "").trim() || null,
    });
    return redirect(`/app/warehouse/stocktakes/${id}`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
};

export default function NewStocktakePage() {
  const { locations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const primary =
    locations.find((l) => l.isPrimary)?.id ?? locations[0]?.id ?? "";
  const [locationId, setLocationId] = useState(primary);
  const [notes, setNotes] = useState("");

  return (
    <Page
      title="New stocktake"
      backAction={{ content: "Warehouse", url: "/app/warehouse" }}
    >
      <TitleBar title="New stocktake" />
      <Form method="post">
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="notes" value={notes} />
        <BlockStack gap="400">
          {actionData?.error ? (
            <Banner tone="critical" title="Could not start stocktake">
              <p>{actionData.error}</p>
            </Banner>
          ) : null}
          <Card>
            <FormLayout>
              <Select
                label="Location"
                options={locations.map((l) => ({
                  label: l.name,
                  value: l.id,
                }))}
                value={locationId}
                onChange={setLocationId}
              />
              <TextField
                label="Notes"
                value={notes}
                onChange={setNotes}
                autoComplete="off"
              />
            </FormLayout>
          </Card>
          <Button
            submit
            variant="primary"
            loading={busy}
            disabled={!locations.length}
          >
            Start stocktake
          </Button>
        </BlockStack>
      </Form>
    </Page>
  );
}
