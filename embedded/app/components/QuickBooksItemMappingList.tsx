import {
  Autocomplete,
  Banner,
  BlockStack,
  Button,
  Card,
  Icon,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useMemo, useState } from "react";
import { matchQboItem, type QboCatalogProduct } from "../lib/quickbooks-map";

type ItemRef = { id: string; name: string };

function ItemPicker({
  productTitle,
  items,
  selectedId,
  selectedName,
  onSelect,
}: {
  productTitle: string;
  items: ItemRef[];
  selectedId: string;
  selectedName: string;
  onSelect: (item: ItemRef | null) => void;
}) {
  const [query, setQuery] = useState(selectedName);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((row) => !q || row.name.toLowerCase().includes(q))
      .slice(0, 50)
      .map((row) => ({ label: row.name, value: row.id }));
  }, [items, query]);

  return (
    <BlockStack gap="200">
      <Autocomplete
        options={options}
        selected={selectedId ? [selectedId] : []}
        onSelect={(selected) => {
          const id = selected[0] ?? "";
          const found = items.find((row) => row.id === id) ?? null;
          onSelect(found);
          setQuery(found?.name ?? "");
        }}
        textField={
          <Autocomplete.TextField
            label={`QuickBooks item for ${productTitle}`}
            labelHidden
            value={query}
            onChange={setQuery}
            autoComplete="off"
            placeholder="Search QuickBooks items"
            prefix={<Icon source={SearchIcon} tone="base" />}
          />
        }
      />
      {selectedId ? (
        <Button
          onClick={() => {
            onSelect(null);
            setQuery("");
          }}
        >
          Clear mapping
        </Button>
      ) : null}
    </BlockStack>
  );
}

export function QuickBooksItemMappingList({
  products,
  items,
  truncated,
  mappings,
  onChange,
}: {
  products: QboCatalogProduct[];
  items: ItemRef[];
  truncated: boolean;
  mappings: Record<string, ItemRef | null>;
  onChange: (supplierProductId: string, item: ItemRef | null) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (row) =>
        row.title.toLowerCase().includes(q) ||
        row.sku.toLowerCase().includes(q) ||
        row.supplierName.toLowerCase().includes(q),
    );
  }, [products, search]);

  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">
        Map catalog products to QuickBooks items
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Each Requisly catalog product can point at one QuickBooks item. Exact
        name matches are suggested; confirm and save to remember them on later
        pushes.
      </Text>
      {!items.length ? (
        <Banner tone="warning" title="No QuickBooks items yet">
          <p>
            This sandbox company has no active items. Create items in QuickBooks
            Online, then return here to map them — or create them during a push
            preview.
          </p>
        </Banner>
      ) : null}
      {truncated ? (
        <Banner tone="info">
          <p>Showing the first 500 catalog products. Search to narrow the list.</p>
        </Banner>
      ) : null}
      <TextField
        label="Search products"
        value={search}
        onChange={setSearch}
        autoComplete="off"
        placeholder="Title, SKU, or supplier"
      />
      {!filtered.length ? (
        <Text as="p" variant="bodySm" tone="subdued">
          No catalog products match that search.
        </Text>
      ) : null}
      {filtered.map((product) => {
        const mapped = mappings[product.id] ?? null;
        return (
          <Card key={product.id} background="bg-surface-secondary">
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="start" wrap>
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    {product.title}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {product.sku || "No SKU"} · {product.supplierName}
                    {mapped ? ` · mapped to ${mapped.name}` : " · not mapped"}
                  </Text>
                </BlockStack>
              </InlineStack>
              <ItemPicker
                productTitle={product.title}
                items={items}
                selectedId={mapped?.id ?? ""}
                selectedName={mapped?.name ?? ""}
                onSelect={(item) => onChange(product.id, item)}
              />
            </BlockStack>
          </Card>
        );
      })}
    </BlockStack>
  );
}

export function initialItemMappings(
  products: QboCatalogProduct[],
  items: ItemRef[],
): Record<string, ItemRef | null> {
  const next: Record<string, ItemRef | null> = {};
  for (const product of products) {
    next[product.id] =
      product.mapped ?? matchQboItem({ title: product.title, sku: product.sku }, items);
  }
  return next;
}
