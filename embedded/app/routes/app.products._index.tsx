import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
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
import { useMemo, useState } from "react";
import { SectionHeading } from "../components/SectionHeading";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import { getMerchantContext } from "../lib/merchant.server";
import { listProductsWorkspace } from "../lib/products.server";
import { syncShopifyCatalogGraphql } from "../lib/shopify-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const data = await listProductsWorkspace(merchant.workspace.id);
  return { workspaceName: merchant.workspace.name, ...data };
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
  const { workspaceName, catalog, variants, syncedAt } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const syncing = navigation.state !== "idle" && navigation.formData != null;
  const [queryValue, setQueryValue] = useState("");

  const filteredCatalog = useMemo(() => {
    const q = queryValue.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((row) => {
      const hay =
        `${row.title} ${row.sku} ${row.supplierName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [catalog, queryValue]);

  const filteredVariants = useMemo(() => {
    const q = queryValue.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter((row) => {
      const hay = `${row.title} ${row.sku}`.toLowerCase();
      return hay.includes(q);
    });
  }, [variants, queryValue]);

  const hasAnyRows = catalog.length > 0 || variants.length > 0;

  return (
    <Page
      title="Products"
      subtitle={workspaceName}
      primaryAction={{ content: "Add catalog product", url: "/app/products/new" }}
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
              queryPlaceholder="Search by name or SKU"
              filters={[]}
              onQueryChange={setQueryValue}
              onQueryClear={() => setQueryValue("")}
              onClearAll={() => setQueryValue("")}
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
            {catalog.length === 0 ? (
              <EmptyState
                heading="No supplier products"
                action={{ content: "Add product", url: "/app/products/new" }}
                image={EMPTY_STATE_IMAGE.products}
              >
                <p>Add products with effective unit costs for PO line picking.</p>
              </EmptyState>
            ) : filteredCatalog.length === 0 ? (
              <EmptyState
                heading="No catalog products match"
                image={EMPTY_STATE_IMAGE.products}
              >
                <p>Try a different product name or SKU.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={filteredCatalog.length}
                headings={[
                  { title: "Product" },
                  { title: "Supplier" },
                  { title: "SKU" },
                  { title: "Unit cost" },
                  { title: "MOQ" },
                ]}
                selectable={false}
              >
                {filteredCatalog.map((row, index) => (
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
            {variants.length === 0 ? (
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
            ) : filteredVariants.length === 0 ? (
              <EmptyState
                heading="No Shopify variants match"
                image={EMPTY_STATE_IMAGE.products}
              >
                <p>Try a different title or SKU.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "variant", plural: "variants" }}
                itemCount={filteredVariants.length}
                headings={[
                  { title: "Title" },
                  { title: "SKU" },
                  { title: "Retail" },
                  { title: "On hand" },
                ]}
                selectable={false}
              >
                {filteredVariants.map((row, index) => (
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
