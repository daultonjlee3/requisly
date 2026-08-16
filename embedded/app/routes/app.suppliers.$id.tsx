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
  EmptyState,
  FormLayout,
  IndexTable,
  InlineGrid,
  InlineStack,
  Page,
  Tabs,
  Text,
  TextField,
  Tooltip,
} from "@shopify/polaris";
import { ChartVerticalIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { SectionHeading } from "../components/SectionHeading";
import { SupplierContactsPanel } from "../components/SupplierContactsPanel";
import { SupplierBlanketsPanel } from "../components/SupplierBlanketsPanel";
import { SupplierContractsPanel } from "../components/SupplierContractsPanel";
import { SupplierProductsPanel } from "../components/SupplierProductsPanel";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import { getMerchantContext } from "../lib/merchant.server";
import {
  linkShopifyVariantsToSupplier,
  listShopifyVariantsForPicker,
} from "../lib/products.server";
import {
  SCORECARD_MIN_COMPLETED_POS,
  daysLabel,
  pctLabel,
  spendLabel,
} from "../lib/supplier-scorecard";
import { loadSupplierScorecardExport } from "../lib/supplier-scorecard.server";
import {
  addSupplierContact,
  deleteSupplierContact,
  getSupplierDetail,
  setPrimarySupplierContact,
  updateSupplier,
  updateSupplierContact,
} from "../lib/suppliers.server";
import {
  createSupplierContract,
  deleteSupplierContract,
  listSupplierContracts,
  updateSupplierContract,
} from "../lib/supplier-contracts.server";
import {
  createBlanketPurchaseOrder,
  listBlanketPurchaseOrders,
} from "../lib/blanket-pos.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const onProductsTab = url.searchParams.get("tab") === "products";
  const merchant = await getMerchantContext(request, {
    sync: onProductsTab ? "auto" : false,
  });
  const supplierId = params.id ?? "";
  const [supplier, scorecard, contracts, blankets] = await Promise.all([
    getSupplierDetail(merchant.workspace.id, supplierId),
    loadSupplierScorecardExport(merchant.workspace.id, supplierId),
    listSupplierContracts(merchant.workspace.id, supplierId),
    listBlanketPurchaseOrders(merchant.workspace.id, { supplierId }),
  ]);
  if (!supplier) throw new Response("Not found", { status: 404 });

  const shopifyVariants = onProductsTab
    ? await listShopifyVariantsForPicker(merchant.workspace.id)
    : [];

  return {
    supplier,
    scorecard,
    contracts,
    blankets,
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
    if (intent === "create_blanket") {
      const created = await createBlanketPurchaseOrder({
        workspaceId: merchant.workspace.id,
        supplierId,
        title: String(formData.get("title") ?? ""),
        startDate: String(formData.get("start_date") ?? ""),
        endDate: String(formData.get("end_date") ?? ""),
        committedQty: String(formData.get("committed_qty") ?? ""),
        committedValue: String(formData.get("committed_value") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      return merchant.redirect(`/app/blankets/${created.id}`);
    }
    if (
      intent === "create_contract" ||
      intent === "update_contract" ||
      intent === "delete_contract"
    ) {
      const fileField = formData.get("file");
      const file =
        fileField instanceof File && fileField.size > 0
          ? {
              name: fileField.name,
              type: fileField.type || "application/octet-stream",
              bytes: Buffer.from(await fileField.arrayBuffer()),
            }
          : null;
      const contractsPath = `/app/suppliers/${supplierId}?tab=contracts`;
      if (intent === "create_contract") {
        await createSupplierContract({
          workspaceId: merchant.workspace.id,
          supplierId,
          title: String(formData.get("title") ?? ""),
          startDate: String(formData.get("start_date") ?? ""),
          renewalDate: String(formData.get("renewal_date") ?? ""),
          notes: String(formData.get("notes") ?? ""),
          file,
        });
        return merchant.redirect(contractsPath);
      }
      if (intent === "update_contract") {
        await updateSupplierContract({
          workspaceId: merchant.workspace.id,
          supplierId,
          contractId: String(formData.get("contract_id") ?? ""),
          title: String(formData.get("title") ?? ""),
          startDate: String(formData.get("start_date") ?? ""),
          renewalDate: String(formData.get("renewal_date") ?? ""),
          notes: String(formData.get("notes") ?? ""),
          file,
        });
        return merchant.redirect(contractsPath);
      }
      await deleteSupplierContract({
        workspaceId: merchant.workspace.id,
        supplierId,
        contractId: String(formData.get("contract_id") ?? ""),
      });
      return merchant.redirect(contractsPath);
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
  const { supplier, scorecard, contracts, blankets, shopifyVariants, syncError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab =
    tabParam === "products"
      ? 1
      : tabParam === "contracts"
        ? 2
        : tabParam === "blankets"
          ? 3
          : 0;

  const [name, setName] = useState(supplier.name);
  const [paymentTerms, setPaymentTerms] = useState(
    supplier.paymentTerms ?? "",
  );
  const [notes, setNotes] = useState(supplier.notes ?? "");

  const onTabChange = useCallback(
    (selected: number) => {
      if (selected === 1) setSearchParams({ tab: "products" });
      else if (selected === 2) setSearchParams({ tab: "contracts" });
      else if (selected === 3) setSearchParams({ tab: "blankets" });
      else setSearchParams({});
    },
    [setSearchParams],
  );

  const alreadyLinkedShopifyVariantIds = supplier.products
    .map((p) => p.shopifyVariantId)
    .filter((id): id is string => Boolean(id));

  const primary =
    supplier.contacts.find((c) => c.isPrimary) ?? supplier.contacts[0];

  const exportReady = Boolean(scorecard?.ready);
  const exportButton = (
    <Button
      url={`/app/suppliers/${supplier.id}/scorecard`}
      target="_blank"
      disabled={!exportReady}
    >
      Export Scorecard
    </Button>
  );

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
      secondaryActions={[
        {
          content: "Upload price sheet",
          url: `/app/suppliers/${supplier.id}/price-sheet`,
        },
      ]}
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

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <SectionHeading
                title="Performance"
                icon={ChartVerticalIcon}
                subtitle={`From ${scorecard?.completedPos ?? 0} closed POs${
                  exportReady
                    ? ""
                    : ` · unlocks at ${SCORECARD_MIN_COMPLETED_POS}`
                }`}
              />
              {exportReady ? (
                exportButton
              ) : (
                <Tooltip content="Not enough order history yet">
                  <span>{exportButton}</span>
                </Tooltip>
              )}
            </InlineStack>
            <InlineGrid columns={4} gap="400">
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  On-time %
                </Text>
                <Text as="p" variant="headingLg">
                  {exportReady ? pctLabel(scorecard?.onTimePct) : "—"}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Fill rate
                </Text>
                <Text as="p" variant="headingLg">
                  {exportReady ? pctLabel(scorecard?.fillRate) : "—"}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Avg lead variance
                </Text>
                <Text as="p" variant="headingLg">
                  {exportReady
                    ? daysLabel(scorecard?.avgLeadTimeVarianceDays)
                    : "—"}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Closed spend
                </Text>
                <Text as="p" variant="headingLg">
                  {exportReady
                    ? spendLabel(scorecard?.closedSpend ?? 0)
                    : "—"}
                </Text>
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>

        <Tabs
          tabs={[
            { id: "orders", content: `Orders (${supplier.orders.length})` },
            {
              id: "products",
              content: `Products (${supplier.products.length})`,
            },
            {
              id: "contracts",
              content: `Contracts (${contracts.length})`,
            },
            {
              id: "blankets",
              content: `Blankets (${blankets.length})`,
            },
          ]}
          selected={tab}
          onSelect={onTabChange}
        >
          {tab === 0 ? (
            supplier.orders.length === 0 ? (
              <Card>
                <EmptyState
                  heading="No orders with this supplier yet"
                  image={EMPTY_STATE_IMAGE.orders}
                  action={{
                    content: "New PO",
                    url: `/app/purchase-orders/new?supplier=${supplier.id}`,
                  }}
                >
                  <p>
                    Create a purchase order to start building history and
                    scorecards for this supplier.
                  </p>
                </EmptyState>
              </Card>
            ) : (
              <Card padding="0">
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
              </Card>
            )
          ) : tab === 1 ? (
            <SupplierProductsPanel
              supplierId={supplier.id}
              products={supplier.products}
              shopifyVariants={shopifyVariants}
              alreadyLinkedShopifyVariantIds={alreadyLinkedShopifyVariantIds}
            />
          ) : tab === 2 ? (
            <SupplierContractsPanel contracts={contracts} />
          ) : (
            <SupplierBlanketsPanel
              blankets={blankets}
              error={
                actionData?.error &&
                navigation.formData?.get("intent") === "create_blanket"
                  ? actionData.error
                  : null
              }
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
