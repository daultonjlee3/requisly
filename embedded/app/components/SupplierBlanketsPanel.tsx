import { Form, useNavigate, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  FormLayout,
  Icon,
  IndexTable,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { OrderIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import type { BlanketListItem } from "../lib/blanket-pos.server";

type Props = {
  blankets: BlanketListItem[];
  error?: string | null;
};

export function SupplierBlanketsPanel({ blankets, error }: Props) {
  const navigation = useNavigation();
  const navigate = useNavigate();
  const busy = navigation.state !== "idle";
  const intent = String(navigation.formData?.get("intent") ?? "");

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [committedQty, setCommittedQty] = useState("");
  const [committedValue, setCommittedValue] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setShowAdd(false);
    setTitle("");
    setStartDate("");
    setEndDate("");
    setCommittedQty("");
    setCommittedValue("");
    setNotes("");
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="start" wrap={false}>
            <Icon source={OrderIcon} tone="base" />
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Blanket POs
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                A committed quantity or value with this supplier. Real POs draw
                it down. Nothing is auto-sent.
              </Text>
            </BlockStack>
          </InlineStack>
          {!showAdd ? (
            <Button onClick={() => setShowAdd(true)}>New blanket</Button>
          ) : null}
        </InlineStack>

        {error ? (
          <Banner tone="critical">
            <p>{error}</p>
          </Banner>
        ) : null}

        {showAdd ? (
          <Card background="bg-surface-secondary">
            <Form method="post">
              <input type="hidden" name="intent" value="create_blanket" />
              <input type="hidden" name="title" value={title} />
              <input type="hidden" name="start_date" value={startDate} />
              <input type="hidden" name="end_date" value={endDate} />
              <input type="hidden" name="committed_qty" value={committedQty} />
              <input
                type="hidden"
                name="committed_value"
                value={committedValue}
              />
              <input type="hidden" name="notes" value={notes} />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  New blanket PO
                </Text>
                <FormLayout>
                  <TextField
                    label="Title"
                    value={title}
                    onChange={setTitle}
                    autoComplete="off"
                    requiredIndicator
                    placeholder="2026 packaging commitment"
                  />
                  <FormLayout.Group>
                    <TextField
                      label="Start date"
                      type="date"
                      value={startDate}
                      onChange={setStartDate}
                      autoComplete="off"
                    />
                    <TextField
                      label="End date"
                      type="date"
                      value={endDate}
                      onChange={setEndDate}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Committed quantity"
                      type="number"
                      min={0}
                      value={committedQty}
                      onChange={setCommittedQty}
                      autoComplete="off"
                      helpText="Leave empty to track value only."
                    />
                    <TextField
                      label="Committed value"
                      type="number"
                      min={0}
                      step={0.01}
                      value={committedValue}
                      onChange={setCommittedValue}
                      autoComplete="off"
                      helpText="Leave empty to track quantity only."
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
                <InlineStack align="end" gap="200">
                  <Button onClick={resetForm} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    submit
                    variant="primary"
                    loading={busy && intent === "create_blanket"}
                    disabled={!title.trim()}
                  >
                    Create blanket
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        ) : null}

        {blankets.length === 0 && !showAdd ? (
          <EmptyState
            heading="No blanket POs yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              Commit a quantity or dollar amount with this supplier, then draw
              it down with real purchase orders.
            </p>
          </EmptyState>
        ) : blankets.length > 0 ? (
          <IndexTable
            resourceName={{ singular: "blanket", plural: "blankets" }}
            itemCount={blankets.length}
            headings={[
              { title: "Blanket" },
              { title: "Period" },
              { title: "Remaining" },
              { title: "Status" },
            ]}
            selectable={false}
          >
            {blankets.map((blanket, index) => (
              <IndexTable.Row
                id={blanket.id}
                key={blanket.id}
                position={index}
                onClick={() => navigate(`/app/blankets/${blanket.id}`)}
              >
                <IndexTable.Cell>
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      {blanket.blanketNumber}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {blanket.title}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>{blanket.periodLabel}</IndexTable.Cell>
                <IndexTable.Cell>{blanket.remainingLabel}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={blanket.statusTone}>{blanket.statusLabel}</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        ) : null}
      </BlockStack>
    </Card>
  );
}
