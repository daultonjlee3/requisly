import { Form, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Layout,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import type {
  CorrectReceiptLine,
  ReceiptCondition,
} from "../lib/po-types";

const CONDITION_OPTIONS = [
  { label: "Good condition", value: "good" },
  { label: "Damaged", value: "damaged" },
  { label: "Wrong item", value: "wrong_item" },
  { label: "Backorder", value: "backorder" },
];

type DraftLine = {
  receipt_line_item_id: string;
  qty_received: string;
  condition: ReceiptCondition;
  reason_note: string;
};

export function CorrectReceiptForm({
  lines,
  note: initialNote,
  error,
}: {
  lines: CorrectReceiptLine[];
  note: string | null;
  error?: string | null;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const [note, setNote] = useState(initialNote ?? "");
  const [drafts, setDrafts] = useState<DraftLine[]>(
    lines.map((line) => ({
      receipt_line_item_id: line.id,
      qty_received: String(line.qtyReceived),
      condition: line.condition,
      reason_note: line.reasonNote ?? "",
    })),
  );

  function update(id: string, patch: Partial<DraftLine>) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.receipt_line_item_id === id ? { ...d, ...patch } : d,
      ),
    );
  }

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="correct" />
      <input type="hidden" name="note" value={note} />
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          drafts.map((d) => ({
            receipt_line_item_id: d.receipt_line_item_id,
            qty_received: Number(d.qty_received) || 0,
            condition: d.condition,
            reason_note: d.reason_note || d.condition,
          })),
        )}
      />

      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not save correction">
            <p>{error}</p>
          </Banner>
        ) : (
          <Banner tone="info" title="Inventory uses the difference">
            <p>
              Shopify and local on-hand are adjusted by new good qty minus what
              this receipt originally recorded — not by the absolute new number
              alone.
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {lines.map((line) => {
                const draft = drafts.find(
                  (d) => d.receipt_line_item_id === line.id,
                )!;
                return (
                  <Card key={line.id}>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">
                        {line.description}
                      </Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Ordered {line.orderedQty} · Originally received{" "}
                        {line.qtyReceived} ({line.condition})
                      </Text>
                      <FormLayout>
                        <TextField
                          label="Corrected quantity"
                          type="number"
                          min={0}
                          value={draft.qty_received}
                          onChange={(value) =>
                            update(line.id, { qty_received: value })
                          }
                          autoComplete="off"
                        />
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
                            value={draft.reason_note}
                            onChange={(value) =>
                              update(line.id, { reason_note: value })
                            }
                            autoComplete="off"
                          />
                        ) : null}
                      </FormLayout>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Receipt note
                </Text>
                <TextField
                  label="Note"
                  labelHidden
                  value={note}
                  onChange={setNote}
                  multiline={3}
                  autoComplete="off"
                />
                <Button submit variant="primary" loading={submitting}>
                  Save correction
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Form>
  );
}
