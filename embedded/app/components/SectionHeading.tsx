import { BlockStack, Icon, InlineStack, Text } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";

/** Polaris-only section title with optional icon — no custom CSS. */
export function SectionHeading({
  title,
  icon,
  subtitle,
}: {
  title: string;
  icon?: IconSource;
  subtitle?: string;
}) {
  return (
    <InlineStack gap="200" blockAlign="start" wrap={false}>
      {icon ? <Icon source={icon} tone="base" /> : null}
      <BlockStack gap="100">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        {subtitle ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {subtitle}
          </Text>
        ) : null}
      </BlockStack>
    </InlineStack>
  );
}
