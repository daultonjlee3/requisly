import {
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type { TemplatePickerItem } from "../lib/po-templates.server";

type Props = {
  recent: TemplatePickerItem[];
  mostUsed: TemplatePickerItem[];
  recentlyUsed: TemplatePickerItem[];
  activeTemplateId?: string | null;
};

function TemplateChipRow({
  title,
  items,
}: {
  title: string;
  items: TemplatePickerItem[];
}) {
  if (!items.length) return null;
  return (
    <BlockStack gap="200">
      <Text as="h3" variant="headingSm">
        {title}
      </Text>
      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
        {items.map((item) => (
          <Card key={`${title}:${item.id}`} background="bg-surface-secondary">
            <BlockStack gap="200">
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {item.name}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {item.supplierName} · {item.productCount} product
                  {item.productCount === 1 ? "" : "s"}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {item.useCount > 0
                    ? `Used ${item.useCount}× · ${item.lastUsedLabel}`
                    : item.lastUsedLabel}
                </Text>
              </BlockStack>
              <InlineStack align="end">
                <Button
                  url={`/app/purchase-orders/new?template=${item.id}`}
                  variant="plain"
                >
                  Use
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        ))}
      </InlineGrid>
    </BlockStack>
  );
}

export function StartFromTemplate({
  recent,
  mostUsed,
  recentlyUsed,
  activeTemplateId,
}: Props) {
  const hasAny = recent.length || mostUsed.length || recentlyUsed.length;
  if (!hasAny) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Start from template
          </Text>
          <Text as="p" tone="subdued">
            No templates yet. Save a recurring PO as a template to draft the
            next one in seconds.
          </Text>
          <InlineStack gap="200">
            <Button url="/app/templates/new">Create template</Button>
            <Button url="/app/templates" variant="plain">
              Browse templates
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Start from template
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {activeTemplateId
                ? "Template applied below — review quantities, then save."
                : "One click fills supplier, ship-to, terms, and lines."}
            </Text>
          </BlockStack>
          <Button url="/app/templates" variant="plain">
            All templates
          </Button>
        </InlineStack>

        <TemplateChipRow title="Recently used" items={recentlyUsed} />
        <TemplateChipRow title="Most used" items={mostUsed} />
        <TemplateChipRow title="Recent templates" items={recent} />
      </BlockStack>
    </Card>
  );
}
