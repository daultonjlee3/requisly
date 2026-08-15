import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  Filters,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { InventoryIcon, ProductIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { SectionHeading } from "../components/SectionHeading";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import {
  indexTablePagination,
  parseListPage,
  parseListQuery,
  patchListParams,
} from "../lib/list-table";
import { getMerchantContext } from "../lib/merchant.server";
import { listProductsWorkspace } from "../lib/products.server";
import { syncShopifyCatalogGraphql } from "../lib/shopify-sync.server";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = parseListQuery(url.searchParams.get("q"));
  const catalogPage = parseListPage(url.searchParams.get("cpage"));
  const variantPage = parseListPage(url.searchParams.get("vpage"));
  const forExport = url.searchParams.get("export") === "1";
  const data = await listProductsWorkspace(merchant.workspace.id, {
    q,
    catalogPage,
    variantPage,
    forExport,
  });
  const exportRows = forExport
    ? [
        ...data.catalog.map((row) => ({
          type: "catalog",
          title: row.title,
          supplier: row.supplierName,
          sku: row.sku,
          cost: row.unitCost,
          extra: row.moq,
        })),
        ...data.variants.map((row) => ({
          type: "variant",
          title: row.title,
          supplier: "",
          sku: row.sku,
          cost: row.retailPrice,
          extra: String(row.onHand),
        })),
      ]
    : null;
  return {
    workspaceName: merchant.workspace.name,
    q,
    catalogPage,
    variantPage,
    exportRows,
    exportToken: forExport ? Date.now() : null,
    ...data,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  try {
    await syncShopifyCatalogGraphql({
      admin: merchant.admin,
      workspaceId: merchant.workspace.id,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Catalog sync failed",
    };
  }
};

export default function ProductsPage() {
  const {
    workspaceName,
    catalog,
    variants,
    catalogTotal,
    variantTotal,
    syncedAt,
    q,
    catalogPage,
    variantPage,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const syncing = navigation.state !== "idle" && navigation.formData != null;
  const [queryValue, setQueryValue] = useState(q);
  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(patchListParams(searchParams, patch));
    },
    [searchParams, setSearchParams],
  );
  const { exportCsv, exporting } = useFilteredCsvExport({
    path: "/app/products",
    searchParams,
    prefix: "products",
    headers: ["type", "title", "supplier", "sku", "cost", "extra"],
    mapRow: (row: {
      type: string;
      title: string;
      supplier: string;
      sku: string;
      cost: string;
      extra: string;
    }) => [row.type, row.title, row.supplier, row.sku, row.cost, row.extra],
  });

  const hasAnyRows = catalogTotal > 0 || variantTotal > 0 || Boolean(q);

  return (
    <Page
      title="Products"
      subtitle={workspaceName}
      primaryAction={{ content: "Add catalog product", url: "/app/products/new" }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: (catalogTotal === 0 && variantTotal === 0) || exporting,
        },
      ]}
    >
      <TitleBar title="Products" />
      <BlockStack gap="500">
        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical" title="Catalog sync failed">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}
        <InlineStack align="end" gap="300" blockAlign="center">
          {syncedAt ? (
            <Text as="span" tone="subdued" variant="bodySm">
              Last sync {new Date(syncedAt).toLocaleString()}
            </Text>
          ) : null}
          <Form method="post">
            <Button submit loading={syncing}>
              Sync Shopify catalog
            </Button>
          </Form>
        </InlineStack>

        {hasAnyRows ? (
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search by name, SKU, or supplier"
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
        ) : null}

        <Card>
          <BlockStack gap="300">
            <SectionHeading
              title="Supplier catalog"
              icon={ProductIcon}
              subtitle="Costed items you buy from suppliers."
            />
            {catalogTotal === 0 && !q ? (
              <EmptyState
                heading="No supplier products"
                action={{ content: "Add product", url: "/app/products/new" }}
                image={EMPTY_STATE_IMAGE.products}
              >
                <p>Add products with effective unit costs for PO line picking.</p>
              </EmptyState>
            ) : catalog.length === 0 ? (
              <EmptyState
                heading="No catalog products match"
                image={EMPTY_STATE_IMAGE.products}
              >
                <p>Try a different product name or SKU.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={catalog.length}
                headings={[
                  { title: "Product" },
                  { title: "Supplier" },
                  { title: "SKU" },
                  { title: "Unit cost" },
                  { title: "MOQ" },
                ]}
                selectable={false}
                pagination={indexTablePagination({
                  page: catalogPage,
                  total: catalogTotal,
                  onPageChange: (next) => applyParams({ cpage: String(next) }),
                })}
              >
                {catalog.map((row, index) => (
                  <IndexTable.Row
                    id={row.id}
                    key={row.id}
                    position={index}
                    onClick={() => navigate(`/app/products/${row.id}`)}
                  >
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {row.title}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.supplierName}</IndexTable.Cell>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.unitCost}</IndexTable.Cell>
                    <IndexTable.Cell>{row.moq}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <SectionHeading
              title="Shopify variants"
              icon={InventoryIcon}
              subtitle="Synced from Admin after catalog sync."
            />
            {variantTotal === 0 && !q ? (
              <EmptyState
                heading="No Shopify catalog synced yet"
                image={EMPTY_STATE_IMAGE.products}
              >
                <p>
                  Pull products, variants, and inventory levels from Shopify so
                  you can receive against real SKUs.
                </p>
                <Form method="post">
                  <Button submit loading={syncing}>
                    Sync Shopify catalog
                  </Button>
                </Form>
              </EmptyState>
            ) : variants.length === 0 ? (
              <EmptyState
                heading="No Shopify variants match"
                image={EMPTY_STATE_IMAGE.products}
              >
                <p>Try a different title or SKU.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "variant", plural: "variants" }}
                itemCount={variants.length}
                headings={[
                  { title: "Title" },
                  { title: "SKU" },
                  { title: "Retail" },
                  { title: "On hand" },
                ]}
                selectable={false}
                pagination={indexTablePagination({
                  page: variantPage,
                  total: variantTotal,
                  onPageChange: (next) => applyParams({ vpage: String(next) }),
                })}
              >
                {variants.map((row, index) => (
                  <IndexTable.Row id={row.id} key={row.id} position={index}>
                    <IndexTable.Cell>{row.title}</IndexTable.Cell>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.retailPrice}</IndexTable.Cell>
                    <IndexTable.Cell>{row.onHand}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
