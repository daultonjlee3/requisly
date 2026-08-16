import { Form, useFetcher, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DropZone,
  EmptyState,
  FormLayout,
  Icon,
  IndexTable,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { NoteIcon } from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import type { SupplierContractRow } from "../lib/supplier-contracts.server";

type Props = {
  contracts: SupplierContractRow[];
};

export function SupplierContractsPanel({ contracts }: Props) {
  const navigation = useNavigation();
  const fetcher = useFetcher<{ error?: string }>();
  const busy = navigation.state !== "idle" || fetcher.state !== "idle";
  const intent = String(
    navigation.formData?.get("intent") ?? fetcher.formData?.get("intent") ?? "",
  );

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function resetForm() {
    setShowAdd(false);
    setEditingId(null);
    setTitle("");
    setStartDate("");
    setRenewalDate("");
    setNotes("");
    setFile(null);
  }

  function startEdit(contract: SupplierContractRow) {
    setShowAdd(false);
    setEditingId(contract.id);
    setTitle(contract.title);
    setStartDate(contract.startDate ?? "");
    setRenewalDate(contract.renewalDate ?? "");
    setNotes(contract.notes ?? "");
    setFile(null);
  }

  const onDrop = useCallback((_drop: File[], accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0]);
  }, []);

  function submit(nextIntent: "create_contract" | "update_contract") {
    if (!title.trim()) return;
    const body = new FormData();
    body.set("intent", nextIntent);
    body.set("title", title);
    body.set("start_date", startDate);
    body.set("renewal_date", renewalDate);
    body.set("notes", notes);
    if (nextIntent === "update_contract" && editingId) {
      body.set("contract_id", editingId);
    }
    if (file) body.set("file", file);
    fetcher.submit(body, { method: "post", encType: "multipart/form-data" });
  }

  const formOpen = showAdd || Boolean(editingId);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="start" wrap={false}>
            <Icon source={NoteIcon} tone="base" />
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Contracts
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Store vendor agreements and renewal dates. We email you before
                a renewal — nothing is auto-renewed or auto-sent.
              </Text>
            </BlockStack>
          </InlineStack>
          {!formOpen ? (
            <Button onClick={() => setShowAdd(true)}>Add contract</Button>
          ) : null}
        </InlineStack>

        {fetcher.data?.error ? (
          <Banner tone="critical">
            <p>{fetcher.data.error}</p>
          </Banner>
        ) : null}

        {formOpen ? (
          <Card background="bg-surface-secondary">
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {editingId ? "Edit contract" : "New contract"}
              </Text>
              <FormLayout>
                <TextField
                  label="Title"
                  value={title}
                  onChange={setTitle}
                  autoComplete="off"
                  requiredIndicator
                  placeholder="2026 packaging supply agreement"
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
                    label="Renewal / end date"
                    type="date"
                    value={renewalDate}
                    onChange={setRenewalDate}
                    autoComplete="off"
                    helpText="Used for the upcoming-renewal notification."
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
              <DropZone
                allowMultiple={false}
                onDrop={onDrop}
                variableHeight
                label={editingId ? "Replace file (optional)" : "Contract file"}
              >
                <DropZone.FileUpload
                  actionHint={
                    file
                      ? file.name
                      : editingId
                        ? "PDF or document — leave empty to keep the current file"
                        : "PDF, Word, Excel, or image"
                  }
                />
              </DropZone>
              <InlineStack align="end" gap="200">
                <Button onClick={resetForm} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={
                    busy &&
                    (intent === "create_contract" ||
                      intent === "update_contract")
                  }
                  disabled={!title.trim()}
                  onClick={() =>
                    submit(editingId ? "update_contract" : "create_contract")
                  }
                >
                  {editingId ? "Save contract" : "Add contract"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : null}

        {contracts.length === 0 && !formOpen ? (
          <EmptyState
            heading="No contracts yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              Add the agreement and a renewal date so Today&apos;s Work is not
              the first time you hear it is expiring.
            </p>
          </EmptyState>
        ) : contracts.length > 0 ? (
          <IndexTable
            resourceName={{ singular: "contract", plural: "contracts" }}
            itemCount={contracts.length}
            headings={[
              { title: "Title" },
              { title: "Start" },
              { title: "Renewal" },
              { title: "File" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {contracts.map((contract, index) => (
              <IndexTable.Row
                id={contract.id}
                key={contract.id}
                position={index}
              >
                <IndexTable.Cell>
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      {contract.title}
                    </Text>
                    {contract.notes ? (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {contract.notes}
                      </Text>
                    ) : null}
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>{contract.startLabel}</IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="span">{contract.renewalLabel}</Text>
                    <Badge tone={contract.renewalTone}>
                      {contract.renewalStatusLabel}
                    </Badge>
                  </InlineStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {contract.downloadUrl ? (
                    <Button url={contract.downloadUrl} target="_blank">
                      {contract.fileName ?? "Download"}
                    </Button>
                  ) : (
                    <Text as="span" tone="subdued">
                      —
                    </Text>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200" wrap>
                    <Button
                      size="slim"
                      onClick={() => startEdit(contract)}
                      disabled={busy}
                    >
                      Edit
                    </Button>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete_contract" />
                      <input
                        type="hidden"
                        name="contract_id"
                        value={contract.id}
                      />
                      <Button
                        submit
                        size="slim"
                        tone="critical"
                        disabled={busy}
                        loading={
                          busy &&
                          intent === "delete_contract" &&
                          String(navigation.formData?.get("contract_id") ?? "") ===
                            contract.id
                        }
                      >
                        Delete
                      </Button>
                    </Form>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        ) : null}

        {busy &&
        (intent === "create_contract" ||
          intent === "update_contract" ||
          intent === "delete_contract") ? (
          <Banner tone="info">
            <p>Updating contracts…</p>
          </Banner>
        ) : null}
      </BlockStack>
    </Card>
  );
}
