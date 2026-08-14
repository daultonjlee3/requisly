import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  ChoiceList,
  DropZone,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  importConfirmedPriceSheetLines,
  matchPriceSheetRows,
  parsePriceSheetCsv,
  type MatchedRow,
} from "../lib/price-sheet.server";
import { getSupplierDetail } from "../lib/suppliers.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: "auto" });
  const supplierId = params.id ?? "";
  const supplier = await getSupplierDetail(merchant.workspace.id, supplierId);
  if (!supplier) throw new Response("Not found", { status: 404 });
  return {
    supplier: { id: supplier.id, name: supplier.name },
    syncError: merchant.syncError,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const supplierId = params.id ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "parse") {
      const file = form.get("csv");
      if (!(file instanceof File) || file.size === 0) {
        return { error: "Upload a CSV file", matches: null, imported: null };
      }
      if (!file.name.toLowerCase().endsWith(".csv")) {
        return {
          error: "CSV only — please upload a .csv price sheet",
          matches: null,
          imported: null,
        };
      }
      const text = await file.text();
      const rows = parsePriceSheetCsv(text);
      const matches = await matchPriceSheetRows(merchant.workspace.id, rows);
      return { error: null, matches, imported: null };
    }

    if (intent === "confirm") {
      const raw = String(form.get("lines_json") ?? "");
      const lines = JSON.parse(raw) as Array<{
        title: string;
        sku: string;
        unitCost: number | null;
        moq: number | null;
        caseQty: number | null;
        leadTimeDays: number | null;
        productVariantId: string | null;
      }>;
      if (!Array.isArray(lines) || !lines.length) {
        return {
          error: "Confirm at least one row",
          matches: null,
          imported: null,
        };
      }
      const result = await importConfirmedPriceSheetLines({
        workspaceId: merchant.workspace.id,
        supplierId,
        lines,
      });
      return merchant.redirect(
        `/app/suppliers/${supplierId}?tab=products&imported=${result.imported}`,
      );
    }

    return { error: "Unknown action", matches: null, imported: null };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Price sheet failed",
      matches: null,
      imported: null,
    };
  }
};

export default function SupplierPriceSheetPage() {
  const { supplier, syncError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const matches = (actionData && "matches" in actionData
    ? actionData.matches
    : null) as MatchedRow[] | null;

  const [file, setFile] = useState<File | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [dismissed, setDismissed] = useState<Record<number, boolean>>({});
  const [manual, setManual] = useState<
    Record<number, { title: string; sku: string; unitCost: string }>
  >({});

  const onDrop = useCallback((_drop: File[], accepted: File[]) => {
    setFile(accepted[0] ?? null);
  }, []);

  const buildConfirmPayload = () => {
    if (!matches) return [];
    const lines: Array<{
      title: string;
      sku: string;
      unitCost: number | null;
      moq: number | null;
      caseQty: number | null;
      leadTimeDays: number | null;
      productVariantId: string | null;
    }> = [];

    for (const row of matches) {
      if (dismissed[row.rowIndex]) continue;

      if (row.matchKind === "exact" && row.productVariantId) {
        lines.push({
          title: row.title,
          sku: row.sku,
          unitCost: row.unitCost,
          moq: row.moq,
          caseQty: row.caseQty,
          leadTimeDays: row.leadTimeDays,
          productVariantId: row.productVariantId,
        });
        continue;
      }

      if (row.matchKind === "fuzzy") {
        const chosen =
          selections[row.rowIndex] ??
          (row.candidates[0] ? row.candidates[0].productVariantId : "");
        if (!chosen) continue;
        const cand = row.candidates.find((c) => c.productVariantId === chosen);
        lines.push({
          title: row.title || cand?.title || row.sku,
          sku: row.sku || cand?.sku || "",
          unitCost: row.unitCost,
          moq: row.moq,
          caseQty: row.caseQty,
          leadTimeDays: row.leadTimeDays,
          productVariantId: chosen,
        });
        continue;
      }

      // none — manual
      const m = manual[row.rowIndex];
      const title = (m?.title || row.title || row.sku).trim();
      if (!title) continue;
      lines.push({
        title,
        sku: (m?.sku || row.sku).trim(),
        unitCost:
          m?.unitCost != null && m.unitCost !== ""
            ? Number(m.unitCost)
            : row.unitCost,
        moq: row.moq,
        caseQty: row.caseQty,
        leadTimeDays: row.leadTimeDays,
        productVariantId: null,
      });
    }
    return lines;
  };

  return (
    <Page
      title={`Price sheet — ${supplier.name}`}
      backAction={{ content: supplier.name, url: `/app/suppliers/${supplier.id}` }}
    >
      <TitleBar title="Upload price sheet" />
      <BlockStack gap="400">
        {syncError ? (
          <Banner tone="warning" title="Catalog sync issue">
            <p>{syncError}</p>
          </Banner>
        ) : null}
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Upload CSV
            </Text>
            <Text as="p" tone="subdued" variant="bodyMd">
              Columns: sku, title, unit_cost, optional moq / case_qty /
              lead_time_days. Exact SKU matches are proposed first; fuzzy
              matches need your confirm — never auto-applied.
            </Text>
            <Form method="post" encType="multipart/form-data">
              <input type="hidden" name="intent" value="parse" />
              <BlockStack gap="300">
                <DropZone
                  accept=".csv,text/csv"
                  type="file"
                  allowMultiple={false}
                  onDrop={onDrop}
                  variableHeight
                >
                  {file ? (
                    <DropZone.FileUpload actionHint={file.name} />
                  ) : (
                    <DropZone.FileUpload actionHint="Accepts .csv only" />
                  )}
                </DropZone>
                {file ? (
                  <input type="file" name="csv" style={{ display: "none" }} />
                ) : null}
                {/* Remix needs the File in FormData — use a real file input sync */}
                <input
                  type="file"
                  name="csv"
                  accept=".csv,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button submit variant="primary" loading={submitting} disabled={!file}>
                  Match SKUs
                </Button>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {matches ? (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Review matches ({matches.length} rows)
              </Text>
              {matches.map((row) => (
                <Card key={row.rowIndex}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {row.sku || "(no sku)"} — {row.title || "Untitled"}
                        {row.unitCost != null
                          ? ` · $${row.unitCost.toFixed(2)}`
                          : ""}
                      </Text>
                      <Button
                        variant="plain"
                        onClick={() =>
                          setDismissed((d) => ({
                            ...d,
                            [row.rowIndex]: !d[row.rowIndex],
                          }))
                        }
                      >
                        {dismissed[row.rowIndex] ? "Undo dismiss" : "Dismiss"}
                      </Button>
                    </InlineStack>

                    {dismissed[row.rowIndex] ? (
                      <Text as="p" tone="subdued">
                        Dismissed — will not import.
                      </Text>
                    ) : row.matchKind === "exact" ? (
                      <Banner tone="success" title="Exact SKU match">
                        <p>
                          Linked to {row.candidates[0]?.title} (
                          {row.candidates[0]?.sku})
                        </p>
                      </Banner>
                    ) : row.matchKind === "fuzzy" ? (
                      <ChoiceList
                        title="Fuzzy candidates — confirm one"
                        choices={row.candidates.map((c) => ({
                          label: `${c.title} (${c.sku}) — ${Math.round(c.confidence * 100)}%`,
                          value: c.productVariantId,
                        }))}
                        selected={[
                          selections[row.rowIndex] ??
                            row.candidates[0]?.productVariantId ??
                            "",
                        ].filter(Boolean)}
                        onChange={(vals) =>
                          setSelections((s) => ({
                            ...s,
                            [row.rowIndex]: vals[0] ?? "",
                          }))
                        }
                      />
                    ) : (
                      <BlockStack gap="200">
                        <Banner tone="warning" title="No catalog match">
                          <p>Add manually or dismiss this row.</p>
                        </Banner>
                        <TextField
                          label="Title"
                          autoComplete="off"
                          value={manual[row.rowIndex]?.title ?? row.title}
                          onChange={(v) =>
                            setManual((m) => ({
                              ...m,
                              [row.rowIndex]: {
                                title: v,
                                sku: m[row.rowIndex]?.sku ?? row.sku,
                                unitCost:
                                  m[row.rowIndex]?.unitCost ??
                                  (row.unitCost != null
                                    ? String(row.unitCost)
                                    : ""),
                              },
                            }))
                          }
                        />
                        <TextField
                          label="SKU"
                          autoComplete="off"
                          value={manual[row.rowIndex]?.sku ?? row.sku}
                          onChange={(v) =>
                            setManual((m) => ({
                              ...m,
                              [row.rowIndex]: {
                                title: m[row.rowIndex]?.title ?? row.title,
                                sku: v,
                                unitCost:
                                  m[row.rowIndex]?.unitCost ??
                                  (row.unitCost != null
                                    ? String(row.unitCost)
                                    : ""),
                              },
                            }))
                          }
                        />
                        <TextField
                          label="Unit cost"
                          autoComplete="off"
                          value={
                            manual[row.rowIndex]?.unitCost ??
                            (row.unitCost != null ? String(row.unitCost) : "")
                          }
                          onChange={(v) =>
                            setManual((m) => ({
                              ...m,
                              [row.rowIndex]: {
                                title: m[row.rowIndex]?.title ?? row.title,
                                sku: m[row.rowIndex]?.sku ?? row.sku,
                                unitCost: v,
                              },
                            }))
                          }
                        />
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              ))}

              <Form method="post">
                <input type="hidden" name="intent" value="confirm" />
                <input
                  type="hidden"
                  name="lines_json"
                  value={JSON.stringify(buildConfirmPayload())}
                />
                <Button submit variant="primary" loading={submitting}>
                  Import confirmed rows
                </Button>
              </Form>
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}
