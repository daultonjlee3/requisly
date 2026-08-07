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
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
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

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Supplier catalog
            </Text>
            {catalog.length === 0 ? (
              <EmptyState
                heading="No supplier products"
                action={{ content: "Add product", url: "/app/products/new" }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Add products with effective unit costs for PO line picking.</p>
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
            <Text as="h2" variant="headingMd">
              Shopify variants
            </Text>
            {variants.length === 0 ? (
              <Text as="p" tone="subdued">
                No synced variants yet. Run Sync Shopify catalog.
              </Text>
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
