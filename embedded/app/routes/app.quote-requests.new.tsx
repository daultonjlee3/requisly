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
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  Icon,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useMemo, useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import { createQuoteRequest } from "../lib/quote-requests.server";
import { createServiceClient } from "../lib/supabase.server";

export type CatalogOption = {
  id: string;
  title: string;
  sku: string | null;
  supplierName: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const supabase = createServiceClient();
  const [{ data: suppliers }, { data: catalog }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, email")
      .eq("workspace_id", merchant.workspace.id)
      .order("name"),
    supabase
      .from("supplier_products")
      .select("id, title, sku, suppliers(name)")
      .eq("workspace_id", merchant.workspace.id)
      .order("title")
      .limit(500),
  ]);
  return {
    suppliers: (suppliers ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      email: (s.email as string | null) ?? null,
    })),
    catalog: (catalog ?? []).map((p) => {
      const supplier = p.suppliers as unknown as { name: string } | null;
      return {
        id: p.id as string,
        title: p.title as string,
        sku: (p.sku as string | null) ?? null,
        supplierName: supplier?.name ?? "—",
      } satisfies CatalogOption;
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  try {
    const supplierIds = JSON.parse(
      String(form.get("supplier_ids") ?? "[]"),
    ) as string[];
    const lines = JSON.parse(String(form.get("lines_json") ?? "[]")) as Array<{
      description: string;
      sku: string;
      qty: number;
      is_free_text: boolean;
      supplier_product_id: string | null;
    }>;
    const { id } = await createQuoteRequest({
      workspaceId: merchant.workspace.id,
      title: String(form.get("title") ?? ""),
      notes: String(form.get("notes") ?? "") || null,
      neededBy: String(form.get("needed_by") ?? "") || null,
      supplierIds,
      lines,
    });
    return redirect(`/app/quote-requests/${id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create request",
    };
  }
};

type LineDraft = {
  key: string;
  description: string;
  sku: string;
  qty: string;
  isFreeText: boolean;
  supplierProductId: string | null;
};

export default function NewQuoteRequestPage() {
  const { suppliers, catalog } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const catalogOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const used = new Set(
      lines.map((l) => l.supplierProductId).filter(Boolean),
    );
    const filtered = catalog.filter((p) => {
      if (used.has(p.id)) return false;
      if (!q) return true;
      return `${p.title} ${p.sku ?? ""} ${p.supplierName}`
        .toLowerCase()
        .includes(q);
    });
    return filtered.slice(0, 20).map((p) => ({
      value: p.id,
      label: p.sku
        ? `${p.title} · ${p.sku} (${p.supplierName})`
        : `${p.title} (${p.supplierName})`,
    }));
  }, [catalog, lines, query]);

  return (
    <Page
      title="New quote request"
      backAction={{ content: "Quote requests", url: "/app/quote-requests" }}
    >
      <TitleBar title="New quote request" />
      <Form method="post">
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="notes" value={notes} />
        <input type="hidden" name="needed_by" value={neededBy} />
        <input type="hidden" name="supplier_ids" value={JSON.stringify(selected)} />
        <input
          type="hidden"
          name="lines_json"
          value={JSON.stringify(
            lines.map((l) => ({
              description: l.description,
              sku: l.sku,
              qty: Number(l.qty),
              is_free_text: l.isFreeText || !l.supplierProductId,
              supplier_product_id: l.isFreeText ? null : l.supplierProductId,
            })),
          )}
        />
        <BlockStack gap="400">
          {actionData?.error ? (
            <Banner tone="critical">
              <p>{actionData.error}</p>
            </Banner>
          ) : null}

          <Card>
            <FormLayout>
              <TextField
                label="Title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
              />
              <TextField
                label="Needed by"
                type="date"
                value={neededBy}
                onChange={setNeededBy}
                autoComplete="off"
              />
              <TextField
                label="Notes for suppliers"
                value={notes}
                onChange={setNotes}
                multiline={3}
                autoComplete="off"
              />
            </FormLayout>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Suppliers to invite
              </Text>
              {suppliers.map((s) => (
                <Checkbox
                  key={s.id}
                  label={`${s.name}${s.email ? ` (${s.email})` : ""}`}
                  checked={selected.includes(s.id)}
                  onChange={(checked) =>
                    setSelected((prev) =>
                      checked
                        ? [...prev, s.id]
                        : prev.filter((id) => id !== s.id),
                    )
                  }
                />
              ))}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Line items
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Pick from the supplier catalog, or add a free-text line — same
                flexibility as PO lines. Award remaps the catalog row onto the
                winning supplier’s product when SKU/variant matches.
              </Text>
              <Autocomplete
                options={catalogOptions}
                selected={[]}
                onSelect={(sel) => {
                  const id = sel[0];
                  if (!id) return;
                  const p = catalog.find((c) => c.id === id);
                  if (!p) return;
                  setLines((prev) => [
                    ...prev,
                    {
                      key: crypto.randomUUID(),
                      description: p.title,
                      sku: p.sku ?? "",
                      qty: "1",
                      isFreeText: false,
                      supplierProductId: p.id,
                    },
                  ]);
                  setQuery("");
                }}
                textField={
                  <Autocomplete.TextField
                    label="Add catalog product"
                    value={query}
                    onChange={setQuery}
                    prefix={<Icon source={SearchIcon} />}
                    placeholder="Search catalog title or SKU"
                    autoComplete="off"
                  />
                }
              />
              {lines.map((line) => (
                <InlineStack key={line.key} gap="200" wrap blockAlign="end">
                  {!line.isFreeText ? <Badge>Catalog</Badge> : <Badge>Custom</Badge>}
                  <TextField
                    label="Description"
                    value={line.description}
                    onChange={(v) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key
                            ? {
                                ...l,
                                description: v,
                                isFreeText: l.supplierProductId ? l.isFreeText : true,
                              }
                            : l,
                        ),
                      )
                    }
                    autoComplete="off"
                    disabled={!line.isFreeText}
                  />
                  <TextField
                    label="SKU"
                    value={line.sku}
                    onChange={(v) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, sku: v } : l,
                        ),
                      )
                    }
                    autoComplete="off"
                    disabled={!line.isFreeText}
                  />
                  <TextField
                    label="Qty"
                    type="number"
                    value={line.qty}
                    onChange={(v) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, qty: v } : l,
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
              <Button
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    {
                      key: crypto.randomUUID(),
                      description: "",
                      sku: "",
                      qty: "1",
                      isFreeText: true,
                      supplierProductId: null,
                    },
                  ])
                }
              >
                Add custom line
              </Button>
            </BlockStack>
          </Card>

          <Button
            submit
            variant="primary"
            loading={submitting}
            disabled={!title.trim() || !selected.length || !lines.length}
          >
            Create draft request
          </Button>
        </BlockStack>
      </Form>
    </Page>
  );
}
