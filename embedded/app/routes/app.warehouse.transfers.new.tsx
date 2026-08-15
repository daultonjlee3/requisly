import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Autocomplete,
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Icon,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useMemo, useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import { listShopifyVariantsForPicker } from "../lib/products.server";
import {
  createTransfer,
  listWorkspaceLocations,
} from "../lib/warehouse.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const [locations, variants] = await Promise.all([
    listWorkspaceLocations(merchant.workspace.id),
    listShopifyVariantsForPicker(merchant.workspace.id),
  ]);
  return { locations, variants };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const fromLocationId = String(form.get("fromLocationId") ?? "");
  const toLocationId = String(form.get("toLocationId") ?? "");
  const notes = String(form.get("notes") ?? "").trim() || null;
  let lines: Array<{ productVariantId: string; qty: number }> = [];
  try {
    lines = JSON.parse(String(form.get("lines_json") ?? "[]"));
  } catch {
    return { error: "Invalid lines" };
  }
  try {
    const { id } = await createTransfer({
      workspaceId: merchant.workspace.id,
      fromLocationId,
      toLocationId,
      notes,
      lines,
    });
    return redirect(`/app/warehouse/transfers/${id}`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
};

type Line = { key: string; productVariantId: string; title: string; qty: string };

export default function NewTransferPage() {
  const { locations, variants } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const [fromLocationId, setFrom] = useState(locations[0]?.id ?? "");
  const [toLocationId, setTo] = useState(locations[1]?.id ?? locations[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants
      .filter((v) => {
        if (!q) return true;
        return (
          v.title.toLowerCase().includes(q) ||
          (v.sku ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 40)
      .map((v) => ({
        value: v.id,
        label: v.sku ? `${v.title} (${v.sku})` : v.title,
      }));
  }, [variants, query]);

  const payload = JSON.stringify(
    lines
      .filter((l) => l.productVariantId && Number(l.qty) > 0)
      .map((l) => ({
        productVariantId: l.productVariantId,
        qty: Number(l.qty),
      })),
  );

  return (
    <Page
      title="New transfer"
      backAction={{ content: "Warehouse", url: "/app/warehouse" }}
    >
      <TitleBar title="New transfer" />
      <Form method="post">
        <input type="hidden" name="fromLocationId" value={fromLocationId} />
        <input type="hidden" name="toLocationId" value={toLocationId} />
        <input type="hidden" name="notes" value={notes} />
        <input type="hidden" name="lines_json" value={payload} />
        <BlockStack gap="400">
          {actionData?.error ? (
            <Banner tone="critical" title="Could not create transfer">
              <p>{actionData.error}</p>
            </Banner>
          ) : null}
          {locations.length < 2 ? (
            <Banner tone="warning" title="Need two locations">
              <p>Sync Shopify locations before transferring stock.</p>
            </Banner>
          ) : null}
          <Card>
            <FormLayout>
              <Select
                label="From location"
                options={locations.map((l) => ({
                  label: l.name,
                  value: l.id,
                }))}
                value={fromLocationId}
                onChange={setFrom}
              />
              <Select
                label="To location"
                options={locations.map((l) => ({
                  label: l.name,
                  value: l.id,
                }))}
                value={toLocationId}
                onChange={setTo}
              />
              <TextField
                label="Notes"
                value={notes}
                onChange={setNotes}
                autoComplete="off"
              />
            </FormLayout>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Line items
              </Text>
              <Autocomplete
                options={options}
                selected={[]}
                onSelect={(sel) => {
                  const id = sel[0];
                  const v = variants.find((x) => x.id === id);
                  if (!v) return;
                  setLines((prev) => [
                    ...prev,
                    {
                      key: crypto.randomUUID(),
                      productVariantId: v.id,
                      title: v.title,
                      qty: "1",
                    },
                  ]);
                  setQuery("");
                }}
                textField={
                  <Autocomplete.TextField
                    label="Add product"
                    value={query}
                    onChange={setQuery}
                    prefix={<Icon source={SearchIcon} />}
                    autoComplete="off"
                  />
                }
              />
              {lines.map((line) => (
                <InlineStack key={line.key} gap="200" blockAlign="center" wrap={false}>
                  <Text as="p" truncate>
                    {line.title}
                  </Text>
                  <TextField
                    label="Qty"
                    labelHidden
                    type="number"
                    value={line.qty}
                    onChange={(val) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, qty: val } : l,
                        ),
                      )
                    }
                    autoComplete="off"
                    min={1}
                  />
                  <Button
                    tone="critical"
                    variant="plain"
                    onClick={() =>
                      setLines((prev) => prev.filter((l) => l.key !== line.key))
                    }
                  >
                    Remove
                  </Button>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
          <Button
            submit
            variant="primary"
            loading={busy}
            disabled={locations.length < 2 || !lines.length}
          >
            Create draft transfer
          </Button>
        </BlockStack>
      </Form>
    </Page>
  );
}
