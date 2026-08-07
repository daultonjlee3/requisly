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
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  IndexTable,
  InlineStack,
  Page,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { SupplierContactsPanel } from "../components/SupplierContactsPanel";
import { SupplierProductsPanel } from "../components/SupplierProductsPanel";
import { getMerchantContext } from "../lib/merchant.server";
import {
  linkShopifyVariantsToSupplier,
  listShopifyVariantsForPicker,
} from "../lib/products.server";
import {
  addSupplierContact,
  deleteSupplierContact,
  getSupplierDetail,
  setPrimarySupplierContact,
  updateSupplier,
  updateSupplierContact,
} from "../lib/suppliers.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const onProductsTab = url.searchParams.get("tab") === "products";
  const merchant = await getMerchantContext(request, {
    sync: onProductsTab ? "auto" : false,
  });
  const supplier = await getSupplierDetail(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!supplier) throw new Response("Not found", { status: 404 });

  const shopifyVariants = onProductsTab
    ? await listShopifyVariantsForPicker(merchant.workspace.id)
    : [];

  return {
    supplier,
    shopifyVariants,
    syncError: merchant.syncError,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "update");
  const supplierId = params.id ?? "";

  try {
    if (intent === "update") {
      await updateSupplier(merchant.workspace.id, supplierId, formData);
      return merchant.redirect(`/app/suppliers/${supplierId}`);
    }
    if (intent === "add_contact") {
      await addSupplierContact(merchant.workspace.id, supplierId, formData);
      return merchant.redirect(`/app/suppliers/${supplierId}`);
    }
    if (intent === "update_contact") {
      await updateSupplierContact(merchant.workspace.id, supplierId, formData);
      return merchant.redirect(`/app/suppliers/${supplierId}`);
    }
    if (intent === "set_primary_contact") {
      await setPrimarySupplierContact(
        merchant.workspace.id,
        supplierId,
        String(formData.get("contact_id") ?? ""),
      );
      return merchant.redirect(`/app/suppliers/${supplierId}`);
    }
    if (intent === "delete_contact") {
      await deleteSupplierContact(
        merchant.workspace.id,
        supplierId,
        String(formData.get("contact_id") ?? ""),
      );
      return merchant.redirect(`/app/suppliers/${supplierId}`);
    }
    if (intent === "link_shopify_products") {
      const effectiveDate =
        String(formData.get("effective_date") ?? "").trim() || null;
      const items = JSON.parse(
        String(formData.get("items_json") ?? "[]"),
      ) as Array<{
        title: string;
        sku: string | null;
        shopifyVariantId: string;
        productVariantId?: string | null;
        unitCost: number | null;
      }>;

      await linkShopifyVariantsToSupplier({
        workspaceId: merchant.workspace.id,
        supplierId,
        items: items.map((item) => ({
          title: item.title,
          sku: item.sku,
          shopifyVariantId: item.shopifyVariantId,
          productVariantId: item.productVariantId ?? null,
          unitCost: item.unitCost,
          effectiveDate,
        })),
      });

      return merchant.redirect(`/app/suppliers/${supplierId}?tab=products`);
    }
    return { error: "Unknown action" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Action failed",
    };
  }
};

export default function SupplierDetail() {
  const { supplier, shopifyVariants, syncError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "products" ? 1 : 0;

  const [name, setName] = useState(supplier.name);
  const [paymentTerms, setPaymentTerms] = useState(
    supplier.paymentTerms ?? "",
  );
  const [notes, setNotes] = useState(supplier.notes ?? "");

  const onTabChange = useCallback(
    (selected: number) => {
      setSearchParams(selected === 1 ? { tab: "products" } : {});
    },
    [setSearchParams],
  );

  const alreadyLinkedShopifyVariantIds = supplier.products
    .map((p) => p.shopifyVariantId)
    .filter((id): id is string => Boolean(id));

  const primary =
    supplier.contacts.find((c) => c.isPrimary) ?? supplier.contacts[0];

  return (
    <Page
      title={supplier.name}
      subtitle={
        primary
          ? `${primary.name} · ${primary.email}`
          : supplier.email
      }
      backAction={{ content: "Suppliers", url: "/app/suppliers" }}
      primaryAction={{
        content: "New PO",
        url: `/app/purchase-orders/new?supplier=${supplier.id}`,
      }}
    >
      <TitleBar title={supplier.name} />
      <BlockStack gap="400">
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {tab === 1 && syncError ? (
          <Banner tone="warning" title="Catalog sync issue">
            <p>
              {syncError}. Browse still opens Shopify’s live product list.
            </p>
          </Banner>
        ) : null}

        <Tabs
          tabs={[
            { id: "orders", content: `Orders (${supplier.orders.length})` },
            {
              id: "products",
              content: `Products (${supplier.products.length})`,
            },
          ]}
          selected={tab}
          onSelect={onTabChange}
        >
          {tab === 0 ? (
            <Card padding="0">
              {supplier.orders.length === 0 ? (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    No purchase orders for this supplier yet.
                  </Text>
                </BlockStack>
              ) : (
                <IndexTable
                  resourceName={{ singular: "order", plural: "orders" }}
                  itemCount={supplier.orders.length}
                  headings={[
                    { title: "PO #" },
                    { title: "Status" },
                    { title: "Total" },
                    { title: "Ship date" },
                    { title: "Updated" },
                  ]}
                  selectable={false}
                >
                  {supplier.orders.map((po, index) => (
                    <IndexTable.Row
                      id={po.id}
                      key={po.id}
                      position={index}
                      onClick={() =>
                        navigate(`/app/purchase-orders/${po.id}`)
                      }
                    >
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="semibold">
                          {po.poNumber}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={po.statusTone}>{po.statusLabel}</Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{po.total}</IndexTable.Cell>
                      <IndexTable.Cell>{po.shipDate}</IndexTable.Cell>
                      <IndexTable.Cell>{po.updated}</IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
          ) : (
            <SupplierProductsPanel
              supplierId={supplier.id}
              products={supplier.products}
              shopifyVariants={shopifyVariants}
              alreadyLinkedShopifyVariantIds={alreadyLinkedShopifyVariantIds}
            />
          )}
        </Tabs>

        <SupplierContactsPanel
          key={`${supplier.id}:${supplier.contacts.map((c) => c.id).join(",")}`}
          contacts={supplier.contacts}
        />

        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="payment_terms" value={paymentTerms} />
            <input type="hidden" name="notes" value={notes} />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Company details
              </Text>
              <FormLayout>
                <TextField
                  label="Company name"
                  value={name}
                  onChange={setName}
                  autoComplete="organization"
                />
                <TextField
                  label="Payment terms"
                  value={paymentTerms}
                  onChange={setPaymentTerms}
                  autoComplete="off"
                />
                <TextField
                  label="Notes"
                  multiline={3}
                  value={notes}
                  onChange={setNotes}
                  autoComplete="off"
                />
              </FormLayout>
              <InlineStack align="end">
                <Button
                  submit
                  variant="primary"
                  loading={
                    navigation.state !== "idle" &&
                    navigation.formData?.get("intent") === "update"
                  }
                >
                  Save details
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
