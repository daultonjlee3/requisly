import { Form, useNavigation } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useMemo, useState } from "react";
import {
  Autocomplete,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  IndexTable,
  InlineStack,
  Layout,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useNavigate } from "@remix-run/react";
import { gidToNumericId } from "../lib/format";
import { todayDateInputValue } from "../lib/pricing";

export type SupplierProductRow = {
  id: string;
  title: string;
  sku: string;
  unitCost: string;
  caseQty: string;
  moq: string;
};

export type ShopifyVariantOption = {
  id: string;
  shopifyVariantId: string;
  title: string;
  sku: string | null;
};

type PendingLink = {
  key: string;
  title: string;
  sku: string;
  shopifyVariantId: string;
  productVariantId: string | null;
  unitCost: string;
};

export function SupplierProductsPanel({
  supplierId,
  products,
  shopifyVariants,
  alreadyLinkedShopifyVariantIds,
}: {
  supplierId: string;
  products: SupplierProductRow[];
  shopifyVariants: ShopifyVariantOption[];
  alreadyLinkedShopifyVariantIds: string[];
}) {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submitting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "link_shopify_products";

  const linkedSet = useMemo(
    () => new Set(alreadyLinkedShopifyVariantIds),
    [alreadyLinkedShopifyVariantIds],
  );

  const [searchValue, setSearchValue] = useState("");
  const [pending, setPending] = useState<PendingLink[]>([]);
  const [effectiveDate, setEffectiveDate] = useState(todayDateInputValue());
  const [pickerError, setPickerError] = useState<string | null>(null);

  const availableVariants = useMemo(
    () =>
      shopifyVariants.filter((v) => !linkedSet.has(v.shopifyVariantId)),
    [linkedSet, shopifyVariants],
  );

  const searchOptions = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    const filtered = !q
      ? availableVariants.slice(0, 20)
      : availableVariants
          .filter((v) => {
            const hay = `${v.title} ${v.sku ?? ""}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 20);
    return filtered.map((v) => ({
      value: v.id,
      label: v.sku ? `${v.title} · ${v.sku}` : v.title,
    }));
  }, [availableVariants, searchValue]);

  function addPending(link: Omit<PendingLink, "key" | "unitCost"> & {
    unitCost?: string;
  }) {
    setPending((prev) => {
      if (prev.some((p) => p.shopifyVariantId === link.shopifyVariantId)) {
        return prev;
      }
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          title: link.title,
          sku: link.sku,
          shopifyVariantId: link.shopifyVariantId,
          productVariantId: link.productVariantId,
          unitCost: link.unitCost ?? "",
        },
      ];
    });
    setSearchValue("");
    setPickerError(null);
  }

  function addFromSyncedVariant(variantRowId: string) {
    const variant = availableVariants.find((v) => v.id === variantRowId);
    if (!variant) return;
    addPending({
      title: variant.title,
      sku: variant.sku ?? "",
      shopifyVariantId: variant.shopifyVariantId,
      productVariantId: variant.id,
    });
  }

  const browseShopifyProducts = useCallback(async () => {
    setPickerError(null);
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "add",
        filter: {
          archived: false,
          draft: false,
        },
      });
      if (!selected?.length) return;

      const next: Array<Omit<PendingLink, "key" | "unitCost">> = [];
      for (const product of selected) {
        const variants =
          product.variants && product.variants.length > 0
            ? product.variants
            : [];
        for (const variant of variants) {
          if (!variant.id) continue;
          const shopifyVariantId = gidToNumericId(variant.id);
          if (linkedSet.has(shopifyVariantId)) continue;
          const synced = shopifyVariants.find(
            (v) => v.shopifyVariantId === shopifyVariantId,
          );
          const variantTitle = variant.title?.trim();
          const title =
            variantTitle && variantTitle !== "Default Title"
              ? `${product.title} — ${variantTitle}`
              : product.title;
          next.push({
            title: synced?.title ?? title,
            sku: synced?.sku ?? variant.sku ?? "",
            shopifyVariantId,
            productVariantId: synced?.id ?? null,
          });
        }
      }

      if (!next.length) {
        setPickerError(
          "No new variants to add. They may already be on this vendor’s list.",
        );
        return;
      }

      setPending((prev) => {
        const seen = new Set(prev.map((p) => p.shopifyVariantId));
        const additions = next
          .filter((n) => !seen.has(n.shopifyVariantId))
          .map((n) => ({
            key: crypto.randomUUID(),
            unitCost: "",
            ...n,
          }));
        return [...prev, ...additions];
      });
    } catch (err) {
      setPickerError(
        err instanceof Error
          ? err.message
          : "Could not open the Shopify product picker",
      );
    }
  }, [linkedSet, shopify, shopifyVariants]);

  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Vendor price list
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Link products from your Shopify catalog, then set this
                  vendor&apos;s unit cost.
                </Text>
              </BlockStack>
              <Button onClick={() => void browseShopifyProducts()}>
                Browse Shopify catalog
              </Button>
            </InlineStack>

            <Autocomplete
              options={searchOptions}
              selected={[]}
              onSelect={(selected) => {
                const id = selected[0];
                if (id) addFromSyncedVariant(id);
              }}
              textField={
                <Autocomplete.TextField
                  onChange={setSearchValue}
                  label="Search Shopify products"
                  labelHidden
                  value={searchValue}
                  placeholder="Search Shopify products to link"
                  prefix={<Icon source={SearchIcon} tone="base" />}
                  autoComplete="off"
                  helpText={
                    shopifyVariants.length === 0
                      ? "No synced Shopify products yet — use Browse for the live catalog."
                      : `${availableVariants.length} Shopify variants available to link`
                  }
                />
              }
            />

            {pickerError ? (
              <Banner tone="critical" onDismiss={() => setPickerError(null)}>
                <p>{pickerError}</p>
              </Banner>
            ) : null}

            {products.length === 0 ? (
              <EmptyState
                heading="No products on this vendor’s list"
                action={{
                  content: "Browse Shopify catalog",
                  onAction: () => void browseShopifyProducts(),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Pull variants from your Shopify product list, then set unit
                  costs for this supplier.
                </p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={products.length}
                headings={[
                  { title: "Product" },
                  { title: "SKU" },
                  { title: "Unit cost" },
                  { title: "Case" },
                  { title: "MOQ" },
                ]}
                selectable={false}
              >
                {products.map((p, index) => (
                  <IndexTable.Row
                    id={p.id}
                    key={p.id}
                    position={index}
                    onClick={() => navigate(`/app/products/${p.id}`)}
                  >
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {p.title}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{p.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{p.unitCost}</IndexTable.Cell>
                    <IndexTable.Cell>{p.caseQty}</IndexTable.Cell>
                    <IndexTable.Cell>{p.moq}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <Card>
          {pending.length === 0 ? (
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Link from Shopify
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Browse or search the Shopify catalog to queue products, set
                each unit cost, then add them to this vendor.
              </Text>
              <Button onClick={() => void browseShopifyProducts()} variant="primary">
                Browse Shopify catalog
              </Button>
            </BlockStack>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="link_shopify_products" />
              <input type="hidden" name="supplier_id" value={supplierId} />
              <input
                type="hidden"
                name="effective_date"
                value={effectiveDate}
              />
              <input
                type="hidden"
                name="items_json"
                value={JSON.stringify(
                  pending.map((p) => ({
                    title: p.title,
                    sku: p.sku,
                    shopifyVariantId: p.shopifyVariantId,
                    productVariantId: p.productVariantId,
                    unitCost:
                      p.unitCost.trim() === ""
                        ? null
                        : Number(p.unitCost),
                  })),
                )}
              />
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Ready to link ({pending.length})
                  </Text>
                  <Button
                    variant="plain"
                    onClick={() => setPending([])}
                  >
                    Clear
                  </Button>
                </InlineStack>

                <TextField
                  label="Effective date"
                  type="date"
                  value={effectiveDate}
                  onChange={setEffectiveDate}
                  autoComplete="off"
                  helpText="Applied to any lines with a unit cost."
                />

                <BlockStack gap="300">
                  {pending.map((item, index) => (
                    <BlockStack key={item.key} gap="200">
                      {index > 0 ? <Divider /> : null}
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {item.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.sku || "No SKU"}
                      </Text>
                      <InlineStack gap="200" blockAlign="end" wrap>
                        <TextField
                          label="Unit cost"
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.unitCost}
                          onChange={(value) =>
                            setPending((prev) =>
                              prev.map((p) =>
                                p.key === item.key
                                  ? { ...p, unitCost: value }
                                  : p,
                              ),
                            )
                          }
                          autoComplete="off"
                          prefix="$"
                        />
                        <Button
                          variant="plain"
                          tone="critical"
                          onClick={() =>
                            setPending((prev) =>
                              prev.filter((p) => p.key !== item.key),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  ))}
                </BlockStack>

                <Button submit variant="primary" loading={submitting}>
                  Add to vendor list
                </Button>
              </BlockStack>
            </Form>
          )}
        </Card>
      </Layout.Section>
    </Layout>
  );
}
