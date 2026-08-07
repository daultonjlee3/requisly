import {
  Badge,
  BlockStack,
  Box,
  Card,
  InlineGrid,
  InlineStack,
  Link,
  Text,
} from "@shopify/polaris";
import { shortDate } from "../lib/format";
import { KANBAN_COLUMNS, type PoStatus } from "../lib/po-status";

export type KanbanPo = {
  id: string;
  poNumber: string;
  status: PoStatus;
  statusLabel: string;
  statusTone?: "info" | "success" | "warning" | "critical";
  total: string;
  requestedShipDateRaw: string | null;
  supplierName: string;
};

export function PoKanbanBoard({
  purchaseOrders,
}: {
  purchaseOrders: KanbanPo[];
}) {
  const byStatus = new Map<PoStatus, KanbanPo[]>();
  for (const step of KANBAN_COLUMNS) {
    byStatus.set(step.key, []);
  }
  for (const po of purchaseOrders) {
    byStatus.get(po.status)?.push(po);
  }

  return (
    <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
      {KANBAN_COLUMNS.map((step) => {
        const cards = byStatus.get(step.key) ?? [];
        return (
          <Card key={step.key}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingSm">
                    {step.label}
                  </Text>
                  {step.skippable ? (
                    <Text as="span" variant="bodySm" tone="subdued">
                      Optional
                    </Text>
                  ) : null}
                </BlockStack>
                <Badge>{String(cards.length)}</Badge>
              </InlineStack>

              {cards.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No POs
                </Text>
              ) : (
                <BlockStack gap="200">
                  {cards.map((po) => (
                    <Box
                      key={po.id}
                      padding="300"
                      borderWidth="025"
                      borderColor="border"
                      borderRadius="200"
                      background="bg-surface"
                    >
                      <BlockStack gap="200">
                        <InlineStack
                          align="space-between"
                          blockAlign="start"
                          gap="200"
                        >
                          <Link
                            url={`/app/purchase-orders/${po.id}`}
                            removeUnderline
                          >
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {po.poNumber}
                            </Text>
                          </Link>
                          <Badge tone={po.statusTone} size="small">
                            {po.statusLabel}
                          </Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm">
                          {po.supplierName}
                        </Text>
                        <InlineStack align="space-between" gap="200">
                          <Text as="span" variant="bodySm" tone="subdued">
                            {shortDate(po.requestedShipDateRaw)}
                          </Text>
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {po.total}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        );
      })}
    </InlineGrid>
  );
}
