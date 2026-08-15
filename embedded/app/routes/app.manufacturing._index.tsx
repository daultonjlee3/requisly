import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Filters,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import {
  indexTablePagination,
  parseListPage,
  parseListQuery,
  patchListParams,
} from "../lib/list-table";
import { getMerchantContext } from "../lib/merchant.server";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";
import {
  acceptMakeToOrderSuggestion,
  listMakeToOrderSuggestions,
  listManufacturingOrders,
} from "../lib/manufacturing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = parseListQuery(url.searchParams.get("q"));
  const page = parseListPage(url.searchParams.get("page"));
  const suggestionPage = parseListPage(url.searchParams.get("spage"));
  const forExport = url.searchParams.get("export") === "1";
  const [orders, suggestions] = await Promise.all([
    listManufacturingOrders(merchant.workspace.id, {
      q,
      ...(forExport ? { forExport: true } : { page }),
    }),
    listMakeToOrderSuggestions(merchant.workspace.id, {
      q,
      ...(forExport ? { forExport: true } : { page: suggestionPage }),
    }),
  ]);
  const exportRows = forExport
    ? [
        ...orders.rows.map((mo) => ({
          type: "mo",
          name: mo.finishedTitle,
          extra: mo.status,
          qty: mo.qtyToMake,
        })),
        ...suggestions.rows.map((s) => ({
          type: "mto_suggestion",
          name: `${s.orderName} ${s.finishedTitle}`,
          extra: s.suggestedLocationName,
          qty: s.qtyToMake,
        })),
      ]
    : null;
  return {
    orders: orders.rows,
    orderTotal: orders.total,
    suggestions: suggestions.rows,
    suggestionTotal: suggestions.total,
    workspaceName: merchant.workspace.name,
    q,
    page,
    suggestionPage,
    exportRows,
    exportToken: forExport ? Date.now() : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent !== "accept_mto") {
    return { error: "Unknown action" };
  }

  try {
    const { id } = await acceptMakeToOrderSuggestion({
      workspaceId: merchant.workspace.id,
      salesOrderId: String(form.get("salesOrderId") ?? "").trim(),
      productVariantId: String(form.get("productVariantId") ?? "").trim(),
      qtyToMake: Number(form.get("qtyToMake")),
      locationId: String(form.get("locationId") ?? "").trim(),
    });
    return redirect(`/app/manufacturing/${id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create MTO",
    };
  }
};

function statusTone(
  status: string,
): "success" | "attention" | "info" | "critical" | undefined {
  if (status === "completed") return "success";
  if (status === "in_progress") return "attention";
  if (status === "cancelled") return "critical";
  return "info";
}

export default function ManufacturingIndex() {
  const {
    orders,
    orderTotal,
    suggestions,
    suggestionTotal,
    workspaceName,
    q,
    page,
    suggestionPage,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const busy = navigation.state !== "idle";
  const [queryValue, setQueryValue] = useState(q);
  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(patchListParams(searchParams, patch));
    },
    [searchParams, setSearchParams],
  );
  const { exportCsv, exporting } = useFilteredCsvExport({
    path: "/app/manufacturing",
    searchParams,
    prefix: "manufacturing",
    headers: ["type", "name", "qty", "extra"],
    mapRow: (row: { type: string; name: string; qty: number; extra: string }) => [
      row.type,
      row.name,
      row.qty,
      row.extra,
    ],
  });

  return (
    <Page
      title="Manufacturing"
      subtitle={workspaceName}
      primaryAction={{ content: "New MO", url: "/app/manufacturing/new" }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: (orderTotal === 0 && suggestionTotal === 0) || exporting,
        },
        { content: "Bills of materials", url: "/app/manufacturing/recipes" },
      ]}
    >
      <TitleBar title="Manufacturing" />
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical" title="Could not create make-to-order MO">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        <Card padding="0">
          <Filters
            queryValue={queryValue}
            queryPlaceholder="Search finished product or sales order"
            filters={[]}
            onQueryChange={setQueryValue}
            onQueryClear={() => {
              setQueryValue("");
              applyParams({ q: null });
            }}
            onQueryBlur={() => applyParams({ q: queryValue || null })}
            onClearAll={() => {
              setQueryValue("");
              applyParams({ q: null });
            }}
          />
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingSm">
              Make-to-order suggestions
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Sales orders that need a BOM finished good when on-hand cannot
              cover demand. Suggestions only — never auto-created. Accept to
              open a draft MO linked to the sales order.
            </Text>
            {suggestions.length === 0 ? (
              <Text as="p" tone="subdued">
                No make-to-order suggestions right now.
              </Text>
            ) : (
              <IndexTable
                resourceName={{
                  singular: "suggestion",
                  plural: "suggestions",
                }}
                itemCount={suggestions.length}
                pagination={indexTablePagination({
                  page: suggestionPage,
                  total: suggestionTotal,
                  onPageChange: (next) => applyParams({ spage: String(next) }),
                })}
                headings={[
                  { title: "Sales order" },
                  { title: "Product" },
                  { title: "Need" },
                  { title: "On hand" },
                  { title: "Make" },
                  { title: "" },
                ]}
                selectable={false}
              >
                {suggestions.map((s, index) => (
                  <IndexTable.Row
                    id={`${s.salesOrderId}-${s.productVariantId}`}
                    key={`${s.salesOrderId}-${s.productVariantId}`}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {s.orderName}
                        </Text>
                        {s.isSyntheticTest ? (
                          <Badge tone="warning">Synthetic</Badge>
                        ) : null}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{s.finishedTitle}</IndexTable.Cell>
                    <IndexTable.Cell>{s.lineQuantity}</IndexTable.Cell>
                    <IndexTable.Cell>{s.onHandTotal}</IndexTable.Cell>
                    <IndexTable.Cell>{s.qtyToMake}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="accept_mto" />
                        <input
                          type="hidden"
                          name="salesOrderId"
                          value={s.salesOrderId}
                        />
                        <input
                          type="hidden"
                          name="productVariantId"
                          value={s.productVariantId}
                        />
                        <input
                          type="hidden"
                          name="qtyToMake"
                          value={String(s.qtyToMake)}
                        />
                        <input
                          type="hidden"
                          name="locationId"
                          value={s.suggestedLocationId}
                        />
                        <Button submit variant="primary" loading={busy} size="slim">
                          Create draft MO
                        </Button>
                      </Form>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card padding="0">
          {orderTotal === 0 && !q ? (
            <Box padding="400">
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  No manufacturing orders yet. Create a BOM, then start a
                  make-to-stock MO — or accept a make-to-order suggestion above.
                </Text>
                <InlineStack gap="200">
                  <Button url="/app/manufacturing/recipes/new">Create BOM</Button>
                  <Button url="/app/manufacturing/new" variant="primary">
                    New MO
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "MO", plural: "MOs" }}
              itemCount={orders.length}
              pagination={indexTablePagination({
                page,
                total: orderTotal,
                onPageChange: (next) => applyParams({ page: String(next) }),
              })}
              headings={[
                { title: "Finished product" },
                { title: "Qty" },
                { title: "Location" },
                { title: "Mode" },
                { title: "Sales order" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {orders.map((mo, index) => (
                <IndexTable.Row id={mo.id} key={mo.id} position={index}>
                  <IndexTable.Cell>
                    <Link to={`/app/manufacturing/${mo.id}`}>
                      <Text as="span" fontWeight="semibold">
                        {mo.finishedTitle}
                      </Text>
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{mo.qtyToMake}</IndexTable.Cell>
                  <IndexTable.Cell>{mo.locationName}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {mo.mode === "make_to_stock"
                      ? "Make-to-stock"
                      : "Make-to-order"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {mo.linkedOrderName ?? "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={statusTone(mo.status)}>{mo.status}</Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
