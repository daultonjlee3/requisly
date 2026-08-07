import { Form, useNavigation } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Autocomplete,
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Icon,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useMemo, useState } from "react";
import {
  costInputValue,
  gidToNumericId,
  money,
  normalizeSku,
  parseMoneyNumber,
} from "../lib/format";
import type {
  NewPoShopifyVariant,
  NewPoSupplierProduct,
} from "../lib/po-types";

export type TemplateFormLine = {
  key: string;
  description: string;
  sku: string;
  qty: string;
  unitCost: string;
  uom: string;
  supplierProductId: string | null;
};

export type TemplateFormValues = {
  name: string;
  description: string;
  supplierId: string;
  locationId: string;
  currency: string;
  notes: string;
  paymentTerms: string;
  status: "active" | "archived";
  lines: TemplateFormLine[];
};

type Props = {
  suppliers: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  shopifyVariants?: NewPoShopifyVariant[];
  /** Vendor catalog rows — used to prefill unit cost when matched. */
  catalogProducts?: NewPoSupplierProduct[];
  priorCosts?: Record<string, number>;
  initial: TemplateFormValues;
  error?: string | null;
  submitLabel?: string;
  sourcePoId?: string | null;
};

function emptyLine(): TemplateFormLine {
  return {
    key: crypto.randomUUID(),
    description: "",
    sku: "",
    qty: "1",
    unitCost: "",
    uom: "ea",
    supplierProductId: null,
  };
}

function isBlankLine(line: TemplateFormLine) {
  return (
    !line.description.trim() &&
    !line.sku.trim() &&
    !line.unitCost.trim() &&
    !line.supplierProductId
  );
}

function findCatalogMatch(
  catalog: NewPoSupplierProduct[],
  shopifyVariantId: string | null,
  sku: string | null,
): NewPoSupplierProduct | undefined {
  if (shopifyVariantId) {
    const byVariant = catalog.find(
      (p) => p.shopifyVariantId === shopifyVariantId,
    );
    if (byVariant) return byVariant;
  }
  const normalized = normalizeSku(sku);
  if (!normalized) return undefined;
  return catalog.find((p) => normalizeSku(p.sku) === normalized);
}

function resolveCost(
  supplierId: string,
  shopifyVariantId: string | null,
  sku: string | null,
  catalogMatch: NewPoSupplierProduct | undefined,
  priorCosts: Record<string, number>,
): string {
  if (catalogMatch?.unitCost != null) {
    return costInputValue(catalogMatch.unitCost);
  }
  if (shopifyVariantId) {
    const prior = priorCosts[`${supplierId}:v:${shopifyVariantId}`];
    if (prior != null) return costInputValue(prior);
  }
  const normalized = normalizeSku(sku);
  if (normalized) {
    const prior = priorCosts[`${supplierId}:sku:${normalized}`];
    if (prior != null) return costInputValue(prior);
  }
  return "";
}

export function TemplateForm({
  suppliers,
  locations,
  shopifyVariants = [],
  catalogProducts = [],
  priorCosts = {},
  initial,
  error,
  submitLabel = "Save template",
  sourcePoId = null,
}: Props) {
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [locationId, setLocationId] = useState(initial.locationId);
  const [currency, setCurrency] = useState(initial.currency || "USD");
  const [notes, setNotes] = useState(initial.notes);
  const [paymentTerms, setPaymentTerms] = useState(initial.paymentTerms);
  const [status, setStatus] = useState(initial.status);
  const [lines, setLines] = useState<TemplateFormLine[]>(
    initial.lines.length ? initial.lines : [emptyLine()],
  );
  const [searchValue, setSearchValue] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const catalogForSupplier = useMemo(
    () =>
      supplierId
        ? catalogProducts.filter((p) => p.supplierId === supplierId)
        : catalogProducts,
    [catalogProducts, supplierId],
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
    return filtered.map((v) => {
      const match = findCatalogMatch(
        catalogForSupplier,
        v.shopifyVariantId,
        v.sku,
      );
      const cost = resolveCost(
        supplierId,
        v.shopifyVariantId,
        v.sku,
        match,
        priorCosts,
      );
      const sku = v.sku ? ` · ${v.sku}` : "";
      const price = cost ? ` — ${money(cost)}` : "";
      return {
        value: v.id,
        label: `${v.title}${sku}${price}`,
      };
    });
  }, [
    catalogForSupplier,
    priorCosts,
    searchValue,
    shopifyVariants,
    supplierId,
  ]);

  function updateLine(key: string, patch: Partial<TemplateFormLine>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function appendLines(next: TemplateFormLine[]) {
    setLines((prev) => {
      const kept = prev.filter((l) => !isBlankLine(l));
      return [...kept, ...next];
    });
    setClientError(null);
  }

  function lineFromShopifyVariant(variant: NewPoShopifyVariant): TemplateFormLine {
    const match = findCatalogMatch(
      catalogForSupplier,
      variant.shopifyVariantId,
      variant.sku,
    );
    return {
      key: crypto.randomUUID(),
      description: match?.title ?? variant.title,
      sku: match?.sku ?? variant.sku ?? "",
      qty: "1",
      unitCost: resolveCost(
        supplierId,
        variant.shopifyVariantId,
        variant.sku,
        match,
        priorCosts,
      ),
      uom: "ea",
      supplierProductId: match?.id ?? null,
    };
  }

  function addShopifyVariant(variantRowId: string) {
    const variant = shopifyVariants.find((v) => v.id === variantRowId);
    if (!variant) return;
    appendLines([lineFromShopifyVariant(variant)]);
    setSearchValue("");
  }

  async function browseShopifyProducts() {
    setClientError(null);
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

      const next: TemplateFormLine[] = [];
      for (const product of selected) {
        const variants =
          product.variants && product.variants.length > 0
            ? product.variants
            : [];
        for (const variant of variants) {
          if (!variant.id) continue;
          const shopifyVariantId = gidToNumericId(variant.id);
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
          next.push(lineFromShopifyVariant(synthetic));
        }
      }

      if (!next.length) {
        setClientError(
          "No variants were selected. Open Browse again and choose at least one variant.",
        );
        return;
      }
      appendLines(next);
    } catch (err) {
      setClientError(
        err instanceof Error
          ? err.message
          : "Could not open the product picker",
      );
    }
  }

  function validate(): boolean {
    if (!name.trim()) {
      setClientError("Template name is required.");
      return false;
    }
    const validLines = lines.filter((l) => l.description.trim());
    if (!validLines.length) {
      setClientError("Add at least one product from Shopify or enter a line.");
      return false;
    }
    setClientError(null);
    return true;
  }

  const displayError = clientError ?? error ?? null;
  const filledLines = lines.filter((l) => !isBlankLine(l));

  return (
    <Form
      method="post"
      onSubmit={(event) => {
        if (!validate()) event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="save" />
      {sourcePoId ? (
        <input type="hidden" name="source_po_id" value={sourcePoId} />
      ) : null}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="supplier_id" value={supplierId} />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="notes" value={notes} />
      <input type="hidden" name="payment_terms" value={paymentTerms} />
      <input type="hidden" name="status" value={status} />
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          lines
            .filter((l) => l.description.trim())
            .map((l) => ({
              description: l.description,
              sku: l.sku,
              qty: Number(l.qty) || 1,
              unit_cost: parseMoneyNumber(l.unitCost) ?? 0,
              uom: l.uom || null,
              supplier_product_id: l.supplierProductId,
            })),
        )}
      />

      <BlockStack gap="400">
        {displayError ? (
          <Banner tone="critical" onDismiss={() => setClientError(null)}>
            <p>{displayError}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Template
            </Text>
            <FormLayout>
              <TextField
                label="Name"
                value={name}
                onChange={setName}
                autoComplete="off"
                requiredIndicator
                placeholder="Monthly packaging restock"
              />
              <TextField
                label="Description"
                value={description}
                onChange={setDescription}
                autoComplete="off"
                multiline={2}
              />
              <FormLayout.Group>
                <Select
                  label="Supplier"
                  options={[
                    { label: "No supplier", value: "" },
                    ...suppliers.map((s) => ({
                      label: s.name,
                      value: s.id,
                    })),
                  ]}
                  value={supplierId}
                  onChange={setSupplierId}
                  helpText="Select a supplier so vendor prices can prefill when products are linked."
                />
                <Select
                  label="Default ship to"
                  options={[
                    { label: "No location", value: "" },
                    ...locations.map((l) => ({
                      label: l.name,
                      value: l.id,
                    })),
                  ]}
                  value={locationId}
                  onChange={setLocationId}
                />
              </FormLayout.Group>
              <FormLayout.Group>
                <TextField
                  label="Currency"
                  value={currency}
                  onChange={setCurrency}
                  autoComplete="off"
                />
                <TextField
                  label="Payment terms"
                  value={paymentTerms}
                  onChange={setPaymentTerms}
                  autoComplete="off"
                />
                <Select
                  label="Status"
                  options={[
                    { label: "Active", value: "active" },
                    { label: "Archived", value: "archived" },
                  ]}
                  value={status}
                  onChange={(v) => setStatus(v as "active" | "archived")}
                />
              </FormLayout.Group>
              <TextField
                label="Notes"
                value={notes}
                onChange={setNotes}
                autoComplete="off"
                multiline={3}
              />
            </FormLayout>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Products
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Pull from your Shopify product library. Templates only speed
                  up drafting — they never create inventory transactions.
                </Text>
              </BlockStack>
              <InlineStack gap="200" wrap>
                <Button onClick={() => void browseShopifyProducts()}>
                  Browse Shopify
                </Button>
                <Button
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  Add custom line
                </Button>
              </InlineStack>
            </InlineStack>

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
                      ? "No synced products yet — use Browse Shopify to pick from the live catalog."
                      : `${shopifyVariants.length} Shopify variants · vendor prices apply when linked`
                  }
                />
              }
            />

            {filledLines.length === 0 ? (
              <Banner tone="info">
                <p>
                  Use <Text as="span" fontWeight="semibold">Browse Shopify</Text>{" "}
                  or search to add products, then set default quantities.
                </p>
              </Banner>
            ) : null}

            {lines.map((line, index) => (
              <Card key={line.key} background="bg-surface-secondary">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    Line {index + 1}
                  </Text>
                  <FormLayout>
                    <TextField
                      label="Product"
                      value={line.description}
                      onChange={(value) =>
                        updateLine(line.key, {
                          description: value,
                          supplierProductId: null,
                        })
                      }
                      autoComplete="off"
                    />
                    <FormLayout.Group>
                      <TextField
                        label="Supplier SKU"
                        value={line.sku}
                        onChange={(value) =>
                          updateLine(line.key, { sku: value })
                        }
                        autoComplete="off"
                      />
                      <TextField
                        label="Qty"
                        type="number"
                        value={line.qty}
                        onChange={(value) =>
                          updateLine(line.key, { qty: value })
                        }
                        autoComplete="off"
                      />
                      <TextField
                        label="Unit cost"
                        type="text"
                        inputMode="decimal"
                        value={line.unitCost}
                        onChange={(value) =>
                          updateLine(line.key, { unitCost: value })
                        }
                        autoComplete="off"
                        prefix="$"
                        helpText={
                          parseMoneyNumber(line.unitCost) != null
                            ? money(line.unitCost)
                            : undefined
                        }
                      />
                      <TextField
                        label="UOM"
                        value={line.uom}
                        onChange={(value) =>
                          updateLine(line.key, { uom: value })
                        }
                        autoComplete="off"
                        placeholder="ea"
                      />
                    </FormLayout.Group>
                  </FormLayout>
                  {lines.length > 1 ? (
                    <InlineStack align="end">
                      <Button
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
                  ) : null}
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        </Card>

        <InlineStack align="end">
          <Button submit variant="primary" loading={submitting}>
            {submitLabel}
          </Button>
        </InlineStack>
      </BlockStack>
    </Form>
  );
}
