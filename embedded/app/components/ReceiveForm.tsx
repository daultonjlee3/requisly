import { Form, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Collapsible,
  FormLayout,
  InlineStack,
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
  const submitting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "receive";
  const [note, setNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);
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
    let already = 0;
    let incoming = 0;
    for (const line of lines) {
      ordered += line.qty;
      already += line.alreadyReceived;
      const draft = drafts.find((d) => d.po_line_item_id === line.id);
      incoming += Number(draft?.qty_received) || 0;
    }
    const received = already + incoming;
    return {
      ordered,
      already,
      incoming,
      received,
      pct: ordered ? Math.min(100, Math.round((received / ordered) * 100)) : 0,
      closes: received >= ordered && incoming > 0,
    };
  }, [lines, drafts]);

  function update(id: string, patch: Partial<DraftLine>) {
    setDrafts((prev) =>
      prev.map((d) => (d.po_line_item_id === id ? { ...d, ...patch } : d)),
    );
  }

  const submitLines = adjusting
    ? drafts
    : lines.map((line) => ({
        po_line_item_id: line.id,
        qty_received: String(line.remaining),
        condition: "good" as ReceiptCondition,
        reason_note: "",
      }));

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="receive" />
      <input type="hidden" name="note" value={note} />
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          submitLines.map((d) => ({
            po_line_item_id: d.po_line_item_id,
            qty_received: Number(d.qty_received) || 0,
            condition: d.condition,
            reason_note: d.reason_note || d.condition,
          })),
        )}
      />

      <Card>
        <BlockStack gap="400">
          {error ? (
            <Banner tone="critical" title="Could not complete receipt">
              <p>{error}</p>
            </Banner>
          ) : null}

          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Receive shipment
              </Text>
              <Text as="span" tone="subdued">
                {progress.received} of {progress.ordered} units
              </Text>
            </InlineStack>
            <ProgressBar progress={progress.pct} size="small" />
            <Text as="p" tone="subdued">
              {progress.closes
                ? "Receiving the rest will mark this PO received and close it."
                : progress.incoming > 0
                  ? "This receipt will leave the PO partially received."
                  : "Enter a quantity to receive."}
            </Text>
          </BlockStack>

          <InlineStack gap="200" wrap>
            {adjusting ? null : (
              <Button
                submit
                variant="primary"
                loading={submitting}
                disabled={
                  lines.reduce((sum, line) => sum + line.remaining, 0) <= 0
                }
              >
                {progress.already > 0
                  ? `Receive remaining ${lines.reduce((sum, line) => sum + line.remaining, 0)} as good`
                  : `Receive all ${lines.reduce((sum, line) => sum + line.remaining, 0)} as good`}
              </Button>
            )}
            <Button
              onClick={() => setAdjusting((open) => !open)}
              disclosure={adjusting ? "up" : "down"}
            >
              {adjusting ? "Hide adjustments" : "Adjust quantities"}
            </Button>
          </InlineStack>

          <Collapsible
            open={adjusting}
            id="receive-adjustments"
            transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
          >
            <BlockStack gap="400">
              {lines.map((line) => {
                const draft = drafts.find(
                  (d) => d.po_line_item_id === line.id,
                )!;
                return (
                  <BlockStack key={line.id} gap="200">
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
                        {line.alreadyReceived > 0 ? (
                          <TextField
                            label="Already received"
                            value={String(line.alreadyReceived)}
                            autoComplete="off"
                            disabled
                          />
                        ) : null}
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
                  </BlockStack>
                );
              })}
              <TextField
                label="Note on this receipt"
                autoComplete="off"
                multiline={2}
                value={note}
                onChange={setNote}
              />
              <Button
                submit
                variant="primary"
                loading={submitting}
                disabled={progress.incoming <= 0}
              >
                Complete this receipt
              </Button>
            </BlockStack>
          </Collapsible>
        </BlockStack>
      </Card>
    </Form>
  );
}
