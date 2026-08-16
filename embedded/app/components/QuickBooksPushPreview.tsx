import { Form, useNavigation } from "@remix-run/react";
import {
  Autocomplete,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  Icon,
  InlineStack,
  Select,
  Text,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useMemo, useState } from "react";
import { money } from "../lib/format";
import type { QboPushPreview } from "../lib/quickbooks-push.server";
import type { QboMappingMode } from "../lib/quickbooks-map";
import { roundMoney } from "../lib/quickbooks-map";

type LineDraft = {
  mappingType: QboMappingMode;
  qboId: string;
  create: boolean;
  query: string;
};

function filterOptions(
  rows: Array<{ id: string; name: string }>,
  query: string,
  extra?: { label: string; value: string },
) {
  const q = query.trim().toLowerCase();
  const mapped = rows
    .filter((row) => !q || row.name.toLowerCase().includes(q))
    .slice(0, 50)
    .map((row) => ({ label: row.name, value: row.id }));
  return extra ? [extra, ...mapped] : mapped;
}

export function QuickBooksPushPreview({
  preview,
  error,
}: {
  preview: QboPushPreview;
  error?: string | null;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const [acknowledged, setAcknowledged] = useState(false);
  const [createVendor, setCreateVendor] = useState(
    !preview.vendor.mapped && !preview.vendor.exact,
  );
  const initialVendor =
    preview.vendor.mapped ??
    preview.vendor.exact ??
    preview.vendor.suggestions[0] ??
    null;
  const [vendorId, setVendorId] = useState(initialVendor?.id ?? "");
  const [vendorQuery, setVendorQuery] = useState(initialVendor?.name ?? "");
  const [defaultAccountId, setDefaultAccountId] = useState(
    preview.settings.defaultExpenseAccountId ??
      preview.accounts[0]?.id ??
      "",
  );
  const [lines, setLines] = useState<Record<string, LineDraft>>(() => {
    const next: Record<string, LineDraft> = {};
    for (const line of preview.lines) {
      next[line.id] = {
        mappingType: line.mappingType,
        qboId:
          line.mappingType === "item"
            ? line.mappedItem?.id ?? ""
            : preview.settings.defaultExpenseAccountId ??
              preview.accounts[0]?.id ??
              "",
        create: line.mappingType === "item" && !line.mappedItem,
        query:
          line.mappingType === "item"
            ? line.mappedItem?.name ?? line.description
            : "",
      };
    }
    return next;
  });

  const accountOptions = preview.accounts.map((row) => ({
    label: row.name,
    value: row.id,
  }));
  const vendorOptions = useMemo(
    () => filterOptions(preview.vendor.vendors, vendorQuery),
    [preview.vendor.vendors, vendorQuery],
  );

  const linePayload = preview.lines.map((line) => {
    const draft = lines[line.id];
    return {
      id: line.id,
      mappingType: line.isFreeText ? "account" : draft?.mappingType ?? "account",
      qboId: line.isFreeText
        ? defaultAccountId
        : draft?.create
          ? ""
          : draft?.qboId ?? "",
      create: !line.isFreeText && Boolean(draft?.create),
    };
  });

  const previewTotal = roundMoney(
    preview.lines.reduce((sum, line) => sum + line.amount, 0) +
      preview.po.taxAmount +
      preview.po.shippingAmount +
      preview.po.adjustmentAmount,
  );

  const vendorChoice = createVendor
    ? "create"
    : preview.vendor.mapped && vendorId === preview.vendor.mapped.id
      ? "mapped"
      : "existing";

  const canSubmit =
    preview.config.configured &&
    preview.connection.connected &&
    !preview.connection.reconnectNeeded &&
    Boolean(defaultAccountId) &&
    (createVendor || Boolean(vendorId)) &&
    preview.gate.ok &&
    (!preview.match.hasDiscrepancy || acknowledged);

  const alreadySynced = Boolean(preview.po.qbPushedAt);

  return (
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="QuickBooks push failed">
          <p>{error}</p>
        </Banner>
      ) : null}

      {!preview.config.configured ? (
        <Banner tone="warning" title="QuickBooks is not configured">
          <p>
            Missing {preview.config.missing.join(", ")} on the embedded app.
          </p>
        </Banner>
      ) : null}

      {preview.connection.reconnectNeeded ? (
        <Banner tone="warning" title="Reconnect needed">
          <p>
            The QuickBooks connection expired or was revoked. Reconnect, then
            return to this preview.
          </p>
          <Button url="/app/quickbooks/connect">Reconnect QuickBooks</Button>
        </Banner>
      ) : null}

      {preview.config.configured && !preview.connection.connected ? (
        <Banner tone="info" title="Connect QuickBooks first">
          <p>Authorize Requisly in Settings, then come back to push this PO.</p>
          <Button url="/app/settings/quickbooks">Open QuickBooks settings</Button>
        </Banner>
      ) : null}

      {preview.catalogError ? (
        <Banner tone="critical" title="Could not load QuickBooks lists">
          <p>{preview.catalogError}</p>
        </Banner>
      ) : null}

      {preview.match.hasDiscrepancy ? (
        <Banner tone="warning" title="3-way discrepancy">
          <p>{preview.match.summary}</p>
        </Banner>
      ) : preview.match.ready ? (
        <Banner tone="success" title="3-way match">
          <p>{preview.match.summary}</p>
        </Banner>
      ) : (
        <Banner tone="info" title="3-way match not ready">
          <p>{preview.gate.reason ?? preview.match.summary}</p>
        </Banner>
      )}

      {alreadySynced ? (
        <Banner tone="info" title="Already synced">
          <p>
            This PO was pushed
            {preview.po.qbPushedAt ? ` at ${preview.po.qbPushedAt}` : ""}.
            Pushing again creates a second QuickBooks bill.
          </p>
          {preview.po.qbBillUrl ? (
            <Button url={preview.po.qbBillUrl} external>
              Open bill in QuickBooks
            </Button>
          ) : null}
        </Banner>
      ) : null}

      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Vendor
          </Text>
          <Text as="p" variant="bodySm">
            Requisly supplier: {preview.po.supplierName}
          </Text>
          {preview.vendor.mapped ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Stored mapping: {preview.vendor.mapped.name}
            </Text>
          ) : preview.vendor.exact ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Exact QuickBooks match: {preview.vendor.exact.name}
            </Text>
          ) : preview.vendor.suggestions.length ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Closest matches:{" "}
              {preview.vendor.suggestions
                .slice(0, 3)
                .map((row) => row.name)
                .join(", ")}
            </Text>
          ) : null}
          <Checkbox
            label={`Create a new QuickBooks vendor named “${preview.po.supplierName}”`}
            checked={createVendor}
            onChange={setCreateVendor}
          />
          {!createVendor ? (
            <Autocomplete
              options={vendorOptions}
              selected={vendorId ? [vendorId] : []}
              onSelect={(selected) => {
                const id = selected[0] ?? "";
                setVendorId(id);
                const found = preview.vendor.vendors.find((row) => row.id === id);
                if (found) setVendorQuery(found.name);
              }}
              textField={
                <Autocomplete.TextField
                  label="QuickBooks vendor"
                  value={vendorQuery}
                  onChange={setVendorQuery}
                  prefix={<Icon source={SearchIcon} tone="base" />}
                  autoComplete="off"
                  placeholder="Search vendors"
                />
              }
            />
          ) : null}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Default expense account
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Used for account-level lines, free-text lines, tax/shipping, and new
            items. Account-level mapping does not ask QuickBooks to calculate
            COGS.
          </Text>
          <Select
            label="Expense / COGS account"
            options={[
              { label: "Select an account", value: "" },
              ...accountOptions,
            ]}
            value={defaultAccountId}
            onChange={setDefaultAccountId}
          />
        </BlockStack>
      </Card>

      {preview.lines.map((line) => {
        const draft = lines[line.id];
        const mappingType = line.isFreeText
          ? "account"
          : draft?.mappingType ?? "account";
        return (
          <Card key={line.id}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    {line.description}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {line.qty} × {money(line.unitCost)} = {money(line.amount)}
                    {line.isFreeText ? " · free-text" : ""}
                  </Text>
                </BlockStack>
                <Text as="span" variant="bodySm">
                  {mappingType === "item" ? "Item" : "Account"}
                </Text>
              </InlineStack>

              {line.isFreeText ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  Free-text lines always use the default expense account.
                </Text>
              ) : (
                <>
                  <ChoiceList
                    title="Post this line as"
                    choices={[
                      {
                        label: "Account",
                        value: "account",
                        helpText: "Expense or COGS account. Zero extra setup.",
                      },
                      {
                        label: "Item",
                        value: "item",
                        helpText:
                          "QuickBooks item. Confirm an existing item or create one.",
                      },
                    ]}
                    selected={[mappingType]}
                    onChange={(selected) => {
                      const next = (selected[0] as QboMappingMode) ?? "account";
                      setLines((prev) => ({
                        ...prev,
                        [line.id]: {
                          mappingType: next,
                          qboId:
                            next === "item"
                              ? line.mappedItem?.id ?? ""
                              : defaultAccountId,
                          create: next === "item" && !line.mappedItem,
                          query: line.mappedItem?.name ?? line.description,
                        },
                      }));
                    }}
                  />
                  {mappingType === "item" ? (
                    <>
                      <Checkbox
                        label={`Create new QuickBooks item “${line.description}”`}
                        checked={Boolean(draft?.create)}
                        onChange={(checked) =>
                          setLines((prev) => ({
                            ...prev,
                            [line.id]: {
                              ...(prev[line.id] ?? {
                                mappingType: "item",
                                qboId: "",
                                create: true,
                                query: line.description,
                              }),
                              create: checked,
                            },
                          }))
                        }
                      />
                      {!draft?.create ? (
                        <Autocomplete
                          options={filterOptions(
                            preview.items,
                            draft?.query ?? "",
                          )}
                          selected={draft?.qboId ? [draft.qboId] : []}
                          onSelect={(selected) => {
                            const id = selected[0] ?? "";
                            const found = preview.items.find((row) => row.id === id);
                            setLines((prev) => ({
                              ...prev,
                              [line.id]: {
                                ...(prev[line.id] ?? {
                                  mappingType: "item",
                                  qboId: "",
                                  create: false,
                                  query: "",
                                }),
                                qboId: id,
                                query: found?.name ?? prev[line.id]?.query ?? "",
                                create: false,
                              },
                            }));
                          }}
                          textField={
                            <Autocomplete.TextField
                              label="QuickBooks item"
                              value={draft?.query ?? ""}
                              onChange={(value) =>
                                setLines((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...(prev[line.id] ?? {
                                      mappingType: "item",
                                      qboId: "",
                                      create: false,
                                      query: "",
                                    }),
                                    query: value,
                                  },
                                }))
                              }
                              autoComplete="off"
                              placeholder="Search items"
                            />
                          }
                        />
                      ) : null}
                    </>
                  ) : (
                    <Select
                      label="Expense account for this line"
                      options={[
                        { label: "Use default account", value: "" },
                        ...accountOptions,
                      ]}
                      value={draft?.qboId ?? ""}
                      onChange={(value) =>
                        setLines((prev) => ({
                          ...prev,
                          [line.id]: {
                            ...(prev[line.id] ?? {
                              mappingType: "account",
                              qboId: "",
                              create: false,
                              query: "",
                            }),
                            qboId: value,
                          },
                        }))
                      }
                    />
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        );
      })}

      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Totals
          </Text>
          <Text as="p" variant="bodySm">
            Line items {money(preview.lines.reduce((sum, line) => sum + line.amount, 0))}
          </Text>
          {preview.po.taxAmount ? (
            <Text as="p" variant="bodySm">
              Tax {money(preview.po.taxAmount)} · Account
            </Text>
          ) : null}
          {preview.po.shippingAmount ? (
            <Text as="p" variant="bodySm">
              Shipping {money(preview.po.shippingAmount)} · Account
            </Text>
          ) : null}
          {preview.po.adjustmentAmount ? (
            <Text as="p" variant="bodySm">
              Adjustment {money(preview.po.adjustmentAmount)} · Account
            </Text>
          ) : null}
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            Bill total {money(previewTotal)}
            {preview.po.invoiceAmount != null
              ? ` · invoiced ${money(preview.po.invoiceAmount)}`
              : ""}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Invoice vs PO differences post as a variance line on the default
            account. Requisly does not reconcile this with QuickBooks COGS.
          </Text>
        </BlockStack>
      </Card>

      <Form method="post">
        <input type="hidden" name="intent" value="confirm_push" />
        <input type="hidden" name="vendor_choice" value={vendorChoice} />
        <input type="hidden" name="vendor_id" value={vendorId} />
        <input type="hidden" name="default_account_id" value={defaultAccountId} />
        <input
          type="hidden"
          name="lines_json"
          value={JSON.stringify(linePayload)}
        />
        {acknowledged ? (
          <input type="hidden" name="acknowledge_discrepancy" value="true" />
        ) : null}
        <BlockStack gap="300">
          {preview.match.hasDiscrepancy ? (
            <Checkbox
              label="I acknowledge this discrepancy and still want to push"
              checked={acknowledged}
              onChange={setAcknowledged}
            />
          ) : null}
          {!alreadySynced ? (
            <Button
              submit
              variant="primary"
              loading={submitting}
              disabled={!canSubmit}
            >
              Confirm and push to QuickBooks
            </Button>
          ) : (
            <>
              <input type="hidden" name="force" value="true" />
              <Button
                submit
                tone="critical"
                loading={submitting}
                disabled={
                  !preview.config.configured ||
                  !preview.connection.connected ||
                  preview.connection.reconnectNeeded ||
                  !defaultAccountId ||
                  (!createVendor && !vendorId) ||
                  (preview.match.hasDiscrepancy && !acknowledged)
                }
              >
                Push again anyway
              </Button>
            </>
          )}
        </BlockStack>
      </Form>
    </BlockStack>
  );
}
