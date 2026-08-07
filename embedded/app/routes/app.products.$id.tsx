import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DescriptionList,
  FormLayout,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  deleteSupplierProductPrice,
  getSupplierProductDetail,
  scheduleSupplierProductPrice,
} from "../lib/products.server";
import { todayDateInputValue } from "../lib/pricing";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const product = await getSupplierProductDetail(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!product) throw new Response("Not found", { status: 404 });
  return { product };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const productId = params.id ?? "";

  try {
    if (intent === "schedule") {
      formData.set("supplier_product_id", productId);
      await scheduleSupplierProductPrice(merchant.workspace.id, formData);
      return merchant.redirect(`/app/products/${productId}`);
    }
    if (intent === "delete_price") {
      const priceId = String(formData.get("price_id") ?? "");
      await deleteSupplierProductPrice(merchant.workspace.id, priceId);
      return merchant.redirect(`/app/products/${productId}`);
    }
    return { error: "Unknown action" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Action failed",
    };
  }
};

export default function ProductDetail() {
  const { product } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [unitCost, setUnitCost] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayDateInputValue());

  return (
    <Page
      title={product.title}
      subtitle={`${product.supplierName}${product.sku ? ` · ${product.sku}` : ""}`}
      backAction={{ content: "Products", url: "/app/products" }}
      primaryAction={{
        content: "New PO",
        url: `/app/purchase-orders/new?supplier=${product.supplierId}`,
      }}
    >
      <TitleBar title={product.title} />
      <BlockStack gap="400">
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Price schedule
                </Text>
                {product.schedule.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No prices yet. Schedule the first effective cost.
                  </Text>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "price", plural: "prices" }}
                    itemCount={product.schedule.length}
                    headings={[
                      { title: "Unit cost" },
                      { title: "Effective" },
                      { title: "Status" },
                      { title: "" },
                    ]}
                    selectable={false}
                  >
                    {product.schedule.map((row, index) => (
                      <IndexTable.Row id={row.id} key={row.id} position={index}>
                        <IndexTable.Cell>{row.unitCost}</IndexTable.Cell>
                        <IndexTable.Cell>{row.effectiveDate}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge
                            tone={
                              row.status === "Current"
                                ? "success"
                                : row.status === "Scheduled"
                                  ? "info"
                                  : undefined
                            }
                          >
                            {row.status}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="delete_price"
                            />
                            <input
                              type="hidden"
                              name="price_id"
                              value={row.id}
                            />
                            <Button
                              submit
                              tone="critical"
                              variant="plain"
                              size="slim"
                            >
                              Delete
                            </Button>
                          </Form>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <DescriptionList
                  items={[
                    { term: "Supplier", description: product.supplierName },
                    { term: "SKU", description: product.sku || "—" },
                    {
                      term: "Current cost",
                      description: product.currentCost,
                    },
                    {
                      term: "Case qty",
                      description:
                        product.caseQty != null
                          ? String(product.caseQty)
                          : "—",
                    },
                    {
                      term: "MOQ",
                      description:
                        product.moq != null ? String(product.moq) : "—",
                    },
                  ]}
                />
              </Card>

              <Card>
                <Form method="post">
                  <input type="hidden" name="intent" value="schedule" />
                  <input type="hidden" name="unit_cost" value={unitCost} />
                  <input
                    type="hidden"
                    name="effective_date"
                    value={effectiveDate}
                  />
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Schedule price
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Future dates stay scheduled until their effective date —
                      current cost never jumps ahead.
                    </Text>
                    <FormLayout>
                      <TextField
                        label="Unit cost"
                        type="number"
                        value={unitCost}
                        onChange={setUnitCost}
                        autoComplete="off"
                      />
                      <TextField
                        label="Effective date"
                        type="date"
                        value={effectiveDate}
                        onChange={setEffectiveDate}
                        autoComplete="off"
                      />
                    </FormLayout>
                    <InlineStack align="end">
                      <Button
                        submit
                        variant="primary"
                        loading={
                          navigation.state !== "idle" &&
                          navigation.formData?.get("intent") === "schedule"
                        }
                      >
                        Add price
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
