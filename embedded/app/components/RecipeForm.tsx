import { Form, useNavigation } from "@remix-run/react";
import {
  Autocomplete,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  Icon,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useMemo, useState } from "react";

export type RecipeFormLine = {
  key: string;
  ingredientProductVariantId: string;
  title: string;
  qtyRequired: string;
  isSubassembly: boolean;
};

type VariantOpt = { id: string; title: string; sku: string | null };

type Props = {
  variants: VariantOpt[];
  initialFinishedVariantId?: string;
  initialName?: string;
  initialLines?: RecipeFormLine[];
  error?: string | null;
  submitLabel?: string;
  recipeId?: string | null;
};

function emptyLine(): RecipeFormLine {
  return {
    key: crypto.randomUUID(),
    ingredientProductVariantId: "",
    title: "",
    qtyRequired: "1",
    isSubassembly: false,
  };
}

export function RecipeForm(props: Props) {
  const {
    variants,
    initialFinishedVariantId = "",
    initialName = "",
    initialLines,
    error,
    submitLabel = "Save BOM",
    recipeId,
  } = props;
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const [finishedId, setFinishedId] = useState(initialFinishedVariantId);
  const [name, setName] = useState(initialName);
  const [lines, setLines] = useState<RecipeFormLine[]>(
    initialLines?.length ? initialLines : [emptyLine()],
  );
  const [query, setQuery] = useState("");

  const finishedOptions = useMemo(
    () =>
      variants.map((v) => ({
        label: v.sku ? `${v.title} (${v.sku})` : v.title,
        value: v.id,
      })),
    [variants],
  );

  const ingredientOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants
      .filter((v) => v.id !== finishedId)
      .filter((v) => {
        if (!q) return true;
        return (
          v.title.toLowerCase().includes(q) ||
          (v.sku ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 40)
      .map((v) => ({
        value: v.id,
        label: v.sku ? `${v.title} (${v.sku})` : v.title,
      }));
  }, [variants, finishedId, query]);

  const payload = JSON.stringify(
    lines
      .filter((l) => l.ingredientProductVariantId && Number(l.qtyRequired) > 0)
      .map((l) => ({
        ingredientProductVariantId: l.ingredientProductVariantId,
        qtyRequired: Number(l.qtyRequired),
        isSubassembly: l.isSubassembly,
      })),
  );

  return (
    <Form method="post">
      {recipeId ? <input type="hidden" name="recipeId" value={recipeId} /> : null}
      <input type="hidden" name="productVariantId" value={finishedId} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="lines_json" value={payload} />
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not save BOM">
            <p>{error}</p>
          </Banner>
        ) : null}

        <Card>
          <FormLayout>
            <Select
              label="Finished product"
              options={[
                { label: "Select finished product…", value: "" },
                ...finishedOptions,
              ]}
              value={finishedId}
              onChange={setFinishedId}
            />
            <TextField
              label="Recipe name (optional)"
              value={name}
              onChange={setName}
              autoComplete="off"
            />
          </FormLayout>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingSm">
              Ingredients
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Raw materials are purchased through the normal supplier catalog /
              PO / Supplier Link flow — not a separate procurement system.
              Mark subassemblies when the ingredient has its own BOM (completion
              explodes recursively).
            </Text>

            <Autocomplete
              options={ingredientOptions}
              selected={[]}
              onSelect={(selected) => {
                const id = selected[0];
                if (!id) return;
                const v = variants.find((x) => x.id === id);
                if (!v) return;
                setLines((prev) => [
                  ...prev.filter((l) => l.ingredientProductVariantId || l.title),
                  {
                    key: crypto.randomUUID(),
                    ingredientProductVariantId: v.id,
                    title: v.title,
                    qtyRequired: "1",
                    isSubassembly: false,
                  },
                ]);
                setQuery("");
              }}
              textField={
                <Autocomplete.TextField
                  label="Add ingredient"
                  value={query}
                  onChange={setQuery}
                  prefix={<Icon source={SearchIcon} />}
                  placeholder="Search catalog variants"
                  autoComplete="off"
                />
              }
            />

            {lines.map((line, index) => (
              <Card key={line.key} background="bg-surface-secondary">
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" fontWeight="semibold">
                      {line.title || `Line ${index + 1}`}
                    </Text>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={() =>
                        setLines((prev) => prev.filter((l) => l.key !== line.key))
                      }
                    >
                      Remove
                    </Button>
                  </InlineStack>
                  <FormLayout>
                    <TextField
                      label="Qty required per finished unit"
                      type="number"
                      value={line.qtyRequired}
                      onChange={(val) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key ? { ...l, qtyRequired: val } : l,
                          ),
                        )
                      }
                      autoComplete="off"
                      min={0}
                    />
                    <Checkbox
                      label="Subassembly (explode nested BOM on complete)"
                      checked={line.isSubassembly}
                      onChange={(checked) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key
                              ? { ...l, isSubassembly: checked }
                              : l,
                          ),
                        )
                      }
                    />
                  </FormLayout>
                </BlockStack>
              </Card>
            ))}

            <Button onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              Add blank line
            </Button>
          </BlockStack>
        </Card>

        <InlineStack gap="200">
          <Button submit variant="primary" loading={submitting}>
            {submitLabel}
          </Button>
        </InlineStack>
      </BlockStack>
    </Form>
  );
}
