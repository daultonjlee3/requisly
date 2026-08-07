import { Form, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  ProgressBar,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import type { ReceiptCondition, ReceiveLine } from "../lib/po-types";

const CONDITION_OPTIONS = [
  { label: "Good condition", value: "good" },
  { label: "Damaged", value: "damaged" },
  { label: "Wrong item", value: "wrong_item" },
  { label: "Backorder", value: "backorder" },
];

type DraftLine = {
  po_line_item_id: string;
  qty_received: string;
  condition: ReceiptCondition;
  reason_note: string;
};

export function ReceiveForm({
  lines,
  error,
}: {
  lines: ReceiveLine[];
  error?: string | null;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<DraftLine[]>(
    lines.map((line) => ({
      po_line_item_id: line.id,
      qty_received: String(line.remaining),
      condition: "good" as ReceiptCondition,
      reason_note: "",
    })),
  );

  const progress = useMemo(() => {
    let ordered = 0;
    let received = 0;
    for (const line of lines) {
      ordered += line.qty;
      const draft = drafts.find((d) => d.po_line_item_id === line.id);
      received +=
        line.alreadyReceived + (Number(draft?.qty_received) || 0);
    }
    return {
      ordered,
      received,
      pct: ordered
        ? Math.min(100, Math.round((received / ordered) * 100))
        : 0,
    };
  }, [lines, drafts]);

  function update(id: string, patch: Partial<DraftLine>) {
    setDrafts((prev) =>
      prev.map((d) => (d.po_line_item_id === id ? { ...d, ...patch } : d)),
    );
  }

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="receive" />
      <input type="hidden" name="note" value={note} />
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          drafts.map((d) => ({
            po_line_item_id: d.po_line_item_id,
            qty_received: Number(d.qty_received) || 0,
            condition: d.condition,
            reason_note: d.reason_note || d.condition,
          })),
        )}
      />

      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not complete receipt">
            <p>{error}</p>
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    What arrived
                  </Text>
                  <Text as="span" tone="subdued">
                    Non-good conditions require a reason note
                  </Text>
                </InlineStack>

                <BlockStack gap="400">
                  {lines.map((line) => {
                    const draft = drafts.find(
                      (d) => d.po_line_item_id === line.id,
                    )!;
                    const remaining = Math.max(
                      line.qty -
                        line.alreadyReceived -
                        (Number(draft.qty_received) || 0),
                      0,
                    );
                    return (
                      <Card key={line.id}>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">
                            {line.description}
                          </Text>
                          <FormLayout>
                            <FormLayout.Group>
                              <TextField
                                label="Ordered"
                                value={String(line.qty)}
                                autoComplete="off"
                                disabled
                              />
                              <TextField
                                label="Already received"
                                value={String(line.alreadyReceived)}
                                autoComplete="off"
                                disabled
                              />
                              <TextField
                                label="This receipt"
                                type="number"
                                min={0}
                                autoComplete="off"
                                value={draft.qty_received}
                                onChange={(value) =>
                                  update(line.id, { qty_received: value })
                                }
                              />
                            </FormLayout.Group>
                            <Select
                              label="Condition"
                              options={CONDITION_OPTIONS}
                              value={draft.condition}
                              onChange={(value) =>
                                update(line.id, {
                                  condition: value as ReceiptCondition,
                                })
                              }
                            />
                            {draft.condition !== "good" ? (
                              <TextField
                                label="Reason note"
                                autoComplete="off"
                                value={draft.reason_note}
                                onChange={(value) =>
                                  update(line.id, { reason_note: value })
                                }
                                requiredIndicator
                              />
                            ) : null}
                          </FormLayout>
                          <Text as="p" tone="subdued">
                            Remaining after this receipt: {remaining}
                          </Text>
                        </BlockStack>
                      </Card>
                    );
                  })}
                </BlockStack>

                <TextField
                  label="Note on this receipt"
                  autoComplete="off"
                  multiline={2}
                  value={note}
                  onChange={setNote}
                />
                <Button submit variant="primary" loading={submitting}>
                  Complete this receipt
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Receiving progress
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {progress.received} of {progress.ordered} units
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {progress.pct}%
                  </Text>
                </InlineStack>
                <ProgressBar progress={progress.pct} size="small" />
                <Text as="p" tone="subdued">
                  {progress.received >= progress.ordered
                    ? "This will mark the PO Received and auto-close it."
                    : "This will mark the PO Partially Received until remaining units arrive (or you Close PO)."}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Form>
  );
}
