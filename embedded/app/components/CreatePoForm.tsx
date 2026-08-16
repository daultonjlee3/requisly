import { Form, useNavigation } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useMemo, useState } from "react";
import {
  Autocomplete,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  InlineGrid,
  InlineStack,
  Layout,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import {
  costInputValue,
  gidToNumericId,
  money,
  normalizeSku,
  parseMoneyNumber,
} from "../lib/format";
import type {
  CreatePoInitialData,
  NewPoFormData,
  NewPoShopifyVariant,
  NewPoSupplierProduct,
} from "../lib/po-types";

type CostSource = "catalog" | "prior" | "manual" | null;

type Line = {
  key: string;
  description: string;
  sku: string;
  qty: string;
  unitCost: string;
  isFreeText: boolean;
  supplierProductId: string | null;
  shopifyVariantId: string | null;
  /** True when unit cost was filled from the vendor price list. */
  fromCatalogPrice: boolean;
  costSource: CostSource;
};

function emptyCustomLine(): Line {
  return {
    key: crypto.randomUUID(),
    description: "",
    sku: "",
    qty: "1",
    unitCost: "",
    isFreeText: true,
    supplierProductId: null,
    shopifyVariantId: null,
    fromCatalogPrice: false,
    costSource: null,
  };
}

function priorVariantKey(supplierId: string, shopifyVariantId: string) {
  return `${supplierId}:v:${shopifyVariantId}`;
}

function priorSkuKey(supplierId: string, sku: string) {
  return `${supplierId}:sku:${sku}`;
}

function resolveUnitCost(opts: {
  supplierId: string;
  shopifyVariantId: string | null;
  sku: string | null;
  catalogMatch: NewPoSupplierProduct | undefined;
  priorCosts: Record<string, number>;
}): { unitCost: string; fromCatalogPrice: boolean; costSource: CostSource } {
  const { supplierId, shopifyVariantId, sku, catalogMatch, priorCosts } = opts;
  if (catalogMatch?.unitCost != null) {
    return {
      unitCost: costInputValue(catalogMatch.unitCost),
      fromCatalogPrice: true,
      costSource: "catalog",
    };
  }
  if (shopifyVariantId) {
    const prior = priorCosts[priorVariantKey(supplierId, shopifyVariantId)];
    if (prior != null) {
      return {
        unitCost: costInputValue(prior),
        fromCatalogPrice: false,
        costSource: "prior",
      };
    }
  }
  const normalized = normalizeSku(sku);
  if (normalized) {
    const prior = priorCosts[priorSkuKey(supplierId, normalized)];
    if (prior != null) {
      return {
        unitCost: costInputValue(prior),
        fromCatalogPrice: false,
        costSource: "prior",
      };
    }
  }
  return {
    unitCost: "",
    fromCatalogPrice: false,
    costSource: null,
  };
}

function lineCostHelp(line: Line): string {
  const amount = parseMoneyNumber(line.unitCost);
  if (line.costSource === "catalog" && amount != null) {
    return `Vendor catalog · ${money(amount)}`;
  }
  if (line.costSource === "prior" && amount != null) {
    return `Prior PO · ${money(amount)}`;
  }
  if (line.costSource === "manual" && amount != null) {
    return `Entered · ${money(amount)}`;
  }
  if (amount != null) {
    return `Unit cost · ${money(amount)}`;
  }
  return line.shopifyVariantId
    ? "From Shopify — enter unit cost"
    : "Enter unit cost";
}

function lineFromCatalog(product: NewPoSupplierProduct): Line {
  const priced = resolveUnitCost({
    supplierId: product.supplierId,
    shopifyVariantId: product.shopifyVariantId,
    sku: product.sku,
    catalogMatch: product,
    priorCosts: {},
  });
  return {
    key: crypto.randomUUID(),
    description: product.title,
    sku: product.sku ?? "",
    qty: "1",
    unitCost: priced.unitCost,
    isFreeText: false,
    supplierProductId: product.id,
    shopifyVariantId: product.shopifyVariantId,
    fromCatalogPrice: priced.fromCatalogPrice,
    costSource: priced.costSource,
  };
}

function findCatalogMatch(
  catalogByShopifyVariant: Map<string, NewPoSupplierProduct>,
  catalogBySku: Map<string, NewPoSupplierProduct>,
  shopifyVariantId: string | null,
  sku: string | null,
): NewPoSupplierProduct | undefined {
  if (shopifyVariantId) {
    const byVariant = catalogByShopifyVariant.get(shopifyVariantId);
    if (byVariant) return byVariant;
  }
  const normalized = normalizeSku(sku);
  if (normalized) return catalogBySku.get(normalized);
  return undefined;
}

function lineFromShopifyVariant(
  variant: NewPoShopifyVariant,
  catalogMatch: NewPoSupplierProduct | undefined,
  supplierId: string,
  priorCosts: Record<string, number>,
): Line {
  const sku = catalogMatch?.sku ?? variant.sku ?? "";
  const priced = resolveUnitCost({
    supplierId,
    shopifyVariantId: variant.shopifyVariantId,
    sku,
    catalogMatch,
    priorCosts,
  });
  return {
    key: crypto.randomUUID(),
    description: catalogMatch?.title ?? variant.title,
    sku,
    qty: "1",
    unitCost: priced.unitCost,
    isFreeText: !catalogMatch,
    supplierProductId: catalogMatch?.id ?? null,
    shopifyVariantId: variant.shopifyVariantId,
    fromCatalogPrice: priced.fromCatalogPrice,
    costSource: priced.costSource,
  };
}

function shopifyOptionLabel(
  variant: NewPoShopifyVariant,
  catalogMatch: NewPoSupplierProduct | undefined,
  supplierId: string,
  priorCosts: Record<string, number>,
) {
  const sku = variant.sku ? ` · ${variant.sku}` : "";
  const priced = resolveUnitCost({
    supplierId,
    shopifyVariantId: variant.shopifyVariantId,
    sku: variant.sku,
    catalogMatch,
    priorCosts,
  });
  if (priced.unitCost) {
    const tag =
      priced.costSource === "catalog"
        ? "vendor price"
        : priced.costSource === "prior"
          ? "prior PO"
          : "cost";
    return `${variant.title}${sku} — ${money(priced.unitCost)} (${tag})`;
  }
  return `${variant.title}${sku}`;
}

function catalogOptionLabel(product: NewPoSupplierProduct) {
  const sku = product.sku ? ` · ${product.sku}` : "";
  if (product.unitCost != null) {
    return `${product.title}${sku} — ${money(product.unitCost)}`;
  }
  return `${product.title}${sku} — no price set`;
}

export type CreatePoInitial = CreatePoInitialData;

export function CreatePoForm({
  formData,
  error,
  syncError,
  catalogSyncPending = false,
  initial,
  submitLabel = "Save draft",
  lockSupplier = false,
  templateId = null,
  showBlanketSelect = true,
}: {
  formData: NewPoFormData;
  error?: string | null;
  syncError?: string | null;
  /** Background catalog refresh in progress — form still usable with last sync. */
  catalogSyncPending?: boolean;
  initial?: CreatePoInitial;
  submitLabel?: string;
  lockSupplier?: boolean;
  /** When set, saved on create so template usage stats stay accurate. */
  templateId?: string | null;
  /** Blanket picker is create-only. Edits keep the original blanket and re-sync remaining. */
  showBlanketSelect?: boolean;
}) {
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const [supplierId, setSupplierId] = useState(
    initial?.supplierId ??
      formData.defaultSupplierId ??
      formData.suppliers[0]?.id ??
      "",
  );
  const [locationId, setLocationId] = useState(
    initial?.locationId ??
      formData.locations.find((l) => l.isPrimary)?.id ??
      formData.locations[0]?.id ??
      "",
  );
  const [shipDate, setShipDate] = useState(initial?.shipDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [paymentTerms, setPaymentTerms] = useState(() => {
    if (initial?.paymentTerms != null) return initial.paymentTerms;
    const sid =
      initial?.supplierId ??
      formData.defaultSupplierId ??
      formData.suppliers[0]?.id ??
      "";
    return formData.suppliers.find((s) => s.id === sid)?.paymentTerms ?? "";
  });
  const [referenceNumber, setReferenceNumber] = useState(
    initial?.referenceNumber ?? "",
  );
  const [taxAmount, setTaxAmount] = useState(initial?.taxAmount ?? "");
  const [shippingAmount, setShippingAmount] = useState(
    initial?.shippingAmount ?? "",
  );
  const [blanketPoId, setBlanketPoId] = useState(initial?.blanketPoId ?? "");
  const [adjustmentAmount, setAdjustmentAmount] = useState(
    initial?.adjustmentAmount ?? "",
  );
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.lines ?? []).map((line) => ({
      ...line,
      unitCost: costInputValue(line.unitCost),
      costSource:
        line.costSource ??
        (line.fromCatalogPrice
          ? "catalog"
          : parseMoneyNumber(line.unitCost) != null
            ? "manual"
            : null),
    })),
  );
  const [searchValue, setSearchValue] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [csvNotice, setCsvNotice] = useState<string | null>(null);

  const catalog = useMemo(
    () => formData.products.filter((p) => p.supplierId === supplierId),
    [formData.products, supplierId],
  );

  const catalogByShopifyVariant = useMemo(() => {
    const map = new Map<string, NewPoSupplierProduct>();
    for (const product of catalog) {
      if (product.shopifyVariantId) {
        map.set(product.shopifyVariantId, product);
      }
    }
    return map;
  }, [catalog]);

  const catalogBySku = useMemo(() => {
    const map = new Map<string, NewPoSupplierProduct>();
    for (const product of catalog) {
      const sku = normalizeSku(product.sku);
      if (sku && !map.has(sku)) map.set(sku, product);
    }
    return map;
  }, [catalog]);

  const shopifyVariants = formData.shopifyVariants;
  const priorCosts = formData.priorCosts ?? {};

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Number(line.qty) || 0;
        const cost = parseMoneyNumber(line.unitCost) ?? 0;
        return sum + qty * cost;
      }, 0),
    [lines],
  );

  const searchOptions = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    const filtered = !q
      ? shopifyVariants.slice(0, 20)
      : shopifyVariants
          .filter((v) => {
            const hay = `${v.title} ${v.sku ?? ""}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 20);
    return filtered.map((v) => ({
      value: v.id,
      label: shopifyOptionLabel(
        v,
        findCatalogMatch(
          catalogByShopifyVariant,
          catalogBySku,
          v.shopifyVariantId,
          v.sku,
        ),
        supplierId,
        priorCosts,
      ),
    }));
  }, [
    catalogByShopifyVariant,
    catalogBySku,
    priorCosts,
    searchValue,
    shopifyVariants,
    supplierId,
  ]);

  const catalogOptions = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const filtered = !q
      ? catalog.slice(0, 20)
      : catalog
          .filter((p) => {
            const hay = `${p.title} ${p.sku ?? ""}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 20);
    return filtered.map((p) => ({
      value: p.id,
      label: catalogOptionLabel(p),
    }));
  }, [catalog, catalogSearch]);

  const grandTotal = useMemo(() => {
    return (
      subtotal +
      (Number(taxAmount) || 0) +
      (Number(shippingAmount) || 0) +
      (Number(adjustmentAmount) || 0)
    );
  }, [adjustmentAmount, shippingAmount, subtotal, taxAmount]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function addShopifyVariant(variantRowId: string) {
    const variant = shopifyVariants.find((v) => v.id === variantRowId);
    if (!variant) return;
    const match = findCatalogMatch(
      catalogByShopifyVariant,
      catalogBySku,
      variant.shopifyVariantId,
      variant.sku,
    );
    setLines((prev) => [
      ...prev,
      lineFromShopifyVariant(variant, match, supplierId, priorCosts),
    ]);
    setSearchValue("");
    setClientError(null);
  }

  function addCatalogProduct(productId: string) {
    const product = catalog.find((p) => p.id === productId);
    if (!product) return;
    // Prefer Shopify-linked pricing path when the catalog row is linked,
    // so prior-cost fallback still works via variant id.
    if (product.shopifyVariantId) {
      const variant =
        shopifyVariants.find(
          (v) => v.shopifyVariantId === product.shopifyVariantId,
        ) ??
        ({
          id: product.shopifyVariantId,
          shopifyVariantId: product.shopifyVariantId,
          title: product.title,
          sku: product.sku,
        } satisfies NewPoShopifyVariant);
      setLines((prev) => [
        ...prev,
        lineFromShopifyVariant(variant, product, supplierId, priorCosts),
      ]);
    } else {
      setLines((prev) => [...prev, lineFromCatalog(product)]);
    }
    setCatalogSearch("");
    setClientError(null);
  }

  function importCsvText(text: string) {
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (!rows.length) {
      setClientError("CSV file is empty.");
      return;
    }
    const start = rows[0]?.toLowerCase().includes("description") ? 1 : 0;
    const imported: Line[] = [];
    for (const row of rows.slice(start)) {
      const cols = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const [description, sku, qty, unitCost] = cols;
      if (!description) continue;
      imported.push({
        key: crypto.randomUUID(),
        description,
        sku: sku ?? "",
        qty: qty && Number(qty) > 0 ? qty : "1",
        unitCost: costInputValue(unitCost),
        isFreeText: true,
        supplierProductId: null,
        shopifyVariantId: null,
        fromCatalogPrice: false,
        costSource: parseMoneyNumber(unitCost) != null ? "manual" : null,
      });
    }
    if (!imported.length) {
      setClientError(
        "No CSV rows parsed. Expected columns: description, sku, qty, unit_cost",
      );
      return;
    }
    setLines((prev) => [...prev, ...imported]);
    setCsvNotice(`Imported ${imported.length} line${imported.length === 1 ? "" : "s"} from CSV.`);
    setClientError(null);
  }

  const browseShopifyProducts = useCallback(async () => {
    setClientError(null);
    try {
      // Full Shopify product list (not filtered by supplier name — that often
      // hides every product when Requisly supplier ≠ Shopify vendor string).
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

      const next: Line[] = [];
      for (const product of selected) {
        const variants =
          product.variants && product.variants.length > 0
            ? product.variants
            : [];

        for (const variant of variants) {
          if (!variant.id) continue;
          const shopifyVariantId = gidToNumericId(variant.id);
          const match = findCatalogMatch(
            catalogByShopifyVariant,
            catalogBySku,
            shopifyVariantId,
            variant.sku ?? null,
          );
          const variantTitle = variant.title?.trim();
          const description =
            variantTitle && variantTitle !== "Default Title"
              ? `${product.title} — ${variantTitle}`
              : product.title;
          const synthetic: NewPoShopifyVariant = {
            id: shopifyVariantId,
            shopifyVariantId,
            title: description,
            sku: variant.sku ?? null,
          };
          next.push(
            lineFromShopifyVariant(synthetic, match, supplierId, priorCosts),
          );
        }
      }

      if (!next.length) {
        setClientError(
          "No variants were selected. Open Browse again and choose at least one variant.",
        );
        return;
      }

      setLines((prev) => [...prev, ...next]);
    } catch (err) {
      setClientError(
        err instanceof Error
          ? err.message
          : "Could not open the product picker",
      );
    }
  }, [
    catalogByShopifyVariant,
    catalogBySku,
    priorCosts,
    shopify,
    supplierId,
  ]);

  function onSupplierChange(next: string) {
    setSupplierId(next);
    setLines([]);
    setSearchValue("");
    setCatalogSearch("");
    setClientError(null);
    setPaymentTerms(
      formData.suppliers.find((s) => s.id === next)?.paymentTerms ?? "",
    );
    const keepBlanket = (formData.blankets ?? []).some(
      (b) => b.id === blanketPoId && b.supplierId === next,
    );
    if (!keepBlanket) setBlanketPoId("");
  }

  const supplierBlankets = (formData.blankets ?? []).filter(
    (b) => b.supplierId === supplierId,
  );

  function validateBeforeSubmit(): boolean {
    if (!supplierId) {
      setClientError("Select a supplier.");
      return false;
    }
    if (!lines.length) {
      setClientError("Add at least one product or custom line.");
      return false;
    }
    for (const line of lines) {
      if (!line.description.trim()) {
        setClientError("Every line needs a product description.");
        return false;
      }
      if (!(Number(line.qty) > 0)) {
        setClientError("Every line needs a quantity greater than zero.");
        return false;
      }
      const cost = parseMoneyNumber(line.unitCost);
      if (cost == null || cost < 0) {
        setClientError(
          "Every line needs a unit cost. Vendor catalog / prior PO prices fill in when available — enter the rest manually.",
        );
        return false;
      }
    }
    setClientError(null);
    return true;
  }

  const displayError = clientError ?? error ?? null;

  return (
    <Form
      method="post"
      onSubmit={(event) => {
        if (!validateBeforeSubmit()) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="intent" value="create" />
      {templateId ? (
        <input type="hidden" name="template_id" value={templateId} />
      ) : null}
      <input type="hidden" name="supplier_id" value={supplierId} />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="requested_ship_date" value={shipDate} />
      <input type="hidden" name="notes" value={notes} />
      <input type="hidden" name="payment_terms" value={paymentTerms} />
      <input type="hidden" name="reference_number" value={referenceNumber} />
      <input type="hidden" name="tax_amount" value={taxAmount} />
      <input type="hidden" name="shipping_amount" value={shippingAmount} />
      <input type="hidden" name="adjustment_amount" value={adjustmentAmount} />
      {showBlanketSelect ? (
        <input type="hidden" name="blanket_po_id" value={blanketPoId} />
      ) : null}
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          lines.map((l) => ({
            description: l.description,
            sku: l.sku,
            qty: Number(l.qty) || 0,
            unit_cost: parseMoneyNumber(l.unitCost) ?? 0,
            is_free_text: l.isFreeText,
            supplier_product_id: l.isFreeText ? null : l.supplierProductId,
          })),
        )}
      />

      <BlockStack gap="400">
        {catalogSyncPending ? (
          <Banner tone="info" title="Catalog syncing…">
            <p>
              Showing your last-synced products while Shopify catalog refreshes
              in the background.
            </p>
          </Banner>
        ) : null}

        {syncError ? (
          <Banner tone="warning" title="Catalog sync issue">
            <p>
              {syncError}. Browse still opens Shopify’s live product list; search
              uses the last synced catalog.
            </p>
          </Banner>
        ) : null}

        {csvNotice ? (
          <Banner tone="success" onDismiss={() => setCsvNotice(null)}>
            <p>{csvNotice}</p>
          </Banner>
        ) : null}

        {displayError ? (
          <Banner
            tone="critical"
            title="Could not save PO"
            onDismiss={() => setClientError(null)}
          >
            <p>{displayError}</p>
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Products
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Unit cost prefills from this vendor&apos;s price list
                      (linked variant or matching SKU), then from the last PO
                      cost for that item.
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200" wrap>
                    <Button onClick={() => void browseShopifyProducts()}>
                      Browse
                    </Button>
                    <Button
                      onClick={() =>
                        setLines((prev) => [...prev, emptyCustomLine()])
                      }
                    >
                      Add custom item
                    </Button>
                  </InlineStack>
                </InlineStack>

                {catalog.length > 0 ? (
                  <Autocomplete
                    options={catalogOptions}
                    selected={[]}
                    onSelect={(selected) => {
                      const id = selected[0];
                      if (id) addCatalogProduct(id);
                    }}
                    textField={
                      <Autocomplete.TextField
                        onChange={setCatalogSearch}
                        label="Add from vendor price list"
                        labelHidden
                        value={catalogSearch}
                        placeholder="Add from vendor price list"
                        prefix={<Icon source={SearchIcon} tone="base" />}
                        autoComplete="off"
                        helpText={`${catalog.length} priced catalog item${catalog.length === 1 ? "" : "s"} for this supplier — cost shows in the list`}
                      />
                    }
                  />
                ) : (
                  <Banner tone="info">
                    <p>
                      This supplier has no vendor catalog prices yet. Link
                      products under Suppliers and set unit costs, or enter
                      costs manually below.
                    </p>
                  </Banner>
                )}

                <Autocomplete
                  options={searchOptions}
                  selected={[]}
                  onSelect={(selected) => {
                    const id = selected[0];
                    if (id) addShopifyVariant(id);
                  }}
                  textField={
                    <Autocomplete.TextField
                      onChange={setSearchValue}
                      label="Search Shopify products"
                      labelHidden
                      value={searchValue}
                      placeholder="Search Shopify products to add"
                      prefix={<Icon source={SearchIcon} tone="base" />}
                      autoComplete="off"
                      helpText={
                        shopifyVariants.length === 0
                          ? "No synced Shopify products yet — use Browse to pick from the live catalog."
                          : `${shopifyVariants.length} Shopify product variant${shopifyVariants.length === 1 ? "" : "s"} · costs prefill from catalog / prior PO when matched`
                      }
                    />
                  }
                />

                {lines.length === 0 ? (
                  <EmptyState
                    heading="Add products to this purchase order"
                    action={{
                      content: "Browse products",
                      onAction: () => void browseShopifyProducts(),
                    }}
                    secondaryAction={{
                      content: "Add custom item",
                      onAction: () =>
                        setLines((prev) => [...prev, emptyCustomLine()]),
                    }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Browse opens your Shopify product list. Search uses synced
                      store products. Vendor catalog pricing fills in when
                      available.
                    </p>
                  </EmptyState>
                ) : (
                  <BlockStack gap="300">
                    <Box
                      paddingBlockEnd="200"
                      borderBlockEndWidth="025"
                      borderColor="border"
                    >
                      <InlineGrid columns={["twoThirds", "oneThird"]} gap="300">
                        <Text
                          as="span"
                          variant="bodySm"
                          fontWeight="semibold"
                          tone="subdued"
                        >
                          Product
                        </Text>
                        <InlineGrid columns={3} gap="200">
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="semibold"
                            tone="subdued"
                          >
                            Qty
                          </Text>
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="semibold"
                            tone="subdued"
                          >
                            Cost
                          </Text>
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="semibold"
                            tone="subdued"
                          >
                            Total
                          </Text>
                        </InlineGrid>
                      </InlineGrid>
                    </Box>

                    {lines.map((line, index) => {
                      const unit = parseMoneyNumber(line.unitCost) ?? 0;
                      const total = (Number(line.qty) || 0) * unit;
                      return (
                        <BlockStack key={line.key} gap="200">
                          {index > 0 ? <Divider /> : null}
                          <InlineGrid
                            columns={["twoThirds", "oneThird"]}
                            gap="300"
                            alignItems="start"
                          >
                            <BlockStack gap="200">
                              <TextField
                                label="Product"
                                labelHidden
                                autoComplete="off"
                                value={line.description}
                                onChange={(value) =>
                                  updateLine(line.key, {
                                    description: value,
                                    isFreeText: true,
                                    supplierProductId: null,
                                    fromCatalogPrice: false,
                                  })
                                }
                                helpText={lineCostHelp(line)}
                              />
                              <TextField
                                label="SKU"
                                labelHidden
                                autoComplete="off"
                                value={line.sku}
                                onChange={(value) =>
                                  updateLine(line.key, { sku: value })
                                }
                                placeholder="SKU"
                              />
                            </BlockStack>
                            <BlockStack gap="200">
                              <InlineGrid columns={3} gap="200">
                                <TextField
                                  label="Qty"
                                  labelHidden
                                  type="number"
                                  autoComplete="off"
                                  min={1}
                                  value={line.qty}
                                  onChange={(value) =>
                                    updateLine(line.key, { qty: value })
                                  }
                                />
                                <TextField
                                  label="Unit cost"
                                  labelHidden
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  value={line.unitCost}
                                  onChange={(value) =>
                                    updateLine(line.key, {
                                      unitCost: value,
                                      fromCatalogPrice: false,
                                      costSource: "manual",
                                    })
                                  }
                                  onBlur={() => {
                                    const normalized = costInputValue(
                                      line.unitCost,
                                    );
                                    if (normalized !== line.unitCost) {
                                      updateLine(line.key, {
                                        unitCost: normalized,
                                        costSource: normalized
                                          ? "manual"
                                          : null,
                                      });
                                    }
                                  }}
                                  prefix="$"
                                />
                                <Box paddingBlockStart="200">
                                  <Text
                                    as="p"
                                    variant="bodyMd"
                                    alignment="end"
                                  >
                                    {money(total)}
                                  </Text>
                                </Box>
                              </InlineGrid>
                              <InlineStack align="end">
                                <Button
                                  variant="plain"
                                  tone="critical"
                                  onClick={() =>
                                    setLines((prev) =>
                                      prev.filter((l) => l.key !== line.key),
                                    )
                                  }
                                >
                                  Remove
                                </Button>
                              </InlineStack>
                            </BlockStack>
                          </InlineGrid>
                        </BlockStack>
                      );
                    })}

                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">
                          Subtotal
                        </Text>
                        <Text as="span">{money(subtotal)}</Text>
                      </InlineStack>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="headingSm">
                          Total
                        </Text>
                        <Text as="span" variant="headingSm">
                          {money(grandTotal)}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                )}

                <Divider />
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    Import CSV lines
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Columns: description, sku, qty, unit_cost
                  </Text>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        importCsvText(String(reader.result ?? ""));
                      };
                      reader.readAsText(file);
                      event.target.value = "";
                    }}
                  />
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Select
                  label="Supplier"
                  options={formData.suppliers.map((s) => ({
                    label: s.name,
                    value: s.id,
                  }))}
                  value={supplierId}
                  onChange={onSupplierChange}
                  disabled={lockSupplier}
                />
                {showBlanketSelect && supplierBlankets.length > 0 ? (
                  <Select
                    label="Draw from blanket"
                    options={[
                      { label: "None — standalone PO", value: "" },
                      ...supplierBlankets.map((b) => ({
                        label: `${b.blanketNumber} · ${b.title} · ${b.remainingLabel} left`,
                        value: b.id,
                        disabled: !b.canDraw,
                      })),
                    ]}
                    value={blanketPoId}
                    onChange={setBlanketPoId}
                    helpText="Draws this draft down against the remaining commitment. Never auto-sends."
                  />
                ) : null}
                <Select
                  label="Ship to"
                  options={formData.locations.map((l) => ({
                    label: l.isPrimary ? `${l.name} (primary)` : l.name,
                    value: l.id,
                  }))}
                  value={locationId}
                  onChange={setLocationId}
                />
                <TextField
                  label="Requested ship date"
                  type="date"
                  autoComplete="off"
                  value={shipDate}
                  onChange={setShipDate}
                />
                <TextField
                  label="Payment terms"
                  autoComplete="off"
                  value={paymentTerms}
                  onChange={setPaymentTerms}
                  placeholder="Net 30"
                />
                <TextField
                  label="Reference #"
                  autoComplete="off"
                  value={referenceNumber}
                  onChange={setReferenceNumber}
                />
                <TextField
                  label="Tax"
                  type="number"
                  min={0}
                  step={0.01}
                  autoComplete="off"
                  value={taxAmount}
                  onChange={setTaxAmount}
                  prefix="$"
                />
                <TextField
                  label="Shipping"
                  type="number"
                  min={0}
                  step={0.01}
                  autoComplete="off"
                  value={shippingAmount}
                  onChange={setShippingAmount}
                  prefix="$"
                />
                <TextField
                  label="Adjustments"
                  type="number"
                  step={0.01}
                  autoComplete="off"
                  value={adjustmentAmount}
                  onChange={setAdjustmentAmount}
                  prefix="$"
                />
                <TextField
                  label="Notes to supplier"
                  autoComplete="off"
                  multiline={3}
                  value={notes}
                  onChange={setNotes}
                  placeholder="Anything the supplier should know…"
                />
                <Button submit variant="primary" loading={submitting}>
                  {submitLabel}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Form>
  );
}
