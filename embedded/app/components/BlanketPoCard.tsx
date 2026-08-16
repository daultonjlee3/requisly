import {
  Badge,
  BlockStack,
  Button,
  Card,
  DescriptionList,
  Icon,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { OrderIcon } from "@shopify/polaris-icons";

type Props = {
  blanket: {
    id: string;
    blanketNumber: string;
    title: string;
    remainingLabel: string;
    statusLabel: string;
    qtyLabel: string;
    valueLabel: string;
    reversed: boolean;
  };
};

export function BlanketPoCard({ blanket }: Props) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={OrderIcon} tone="base" />
            <Text as="h2" variant="headingMd">
              Blanket PO
            </Text>
          </InlineStack>
          <Badge tone={blanket.reversed ? "attention" : "info"}>
            {blanket.reversed ? "Released" : blanket.statusLabel}
          </Badge>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {blanket.reversed
            ? "This PO was cancelled, so its draw-down was returned to the blanket."
            : `${blanket.blanketNumber} · ${blanket.title}`}
        </Text>
        <DescriptionList
          items={[
            { term: "Blanket", description: `${blanket.blanketNumber} · ${blanket.title}` },
            { term: "Drawn on this PO", description: `${blanket.qtyLabel} units · ${blanket.valueLabel}` },
            { term: "Remaining on blanket", description: blanket.remainingLabel },
          ]}
        />
        <InlineStack align="end">
          <Button url={`/app/blankets/${blanket.id}`}>View blanket</Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
