import {
  Badge,
  BlockStack,
  Button,
  Card,
  DataTable,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { BarChart, LineChart } from "@shopify/polaris-viz";
import { useState } from "react";
import { downloadCsv, stampFilename, toCsv } from "../lib/csv";
import type { ReportResult } from "../lib/report-builder.server";

const TEXT_COLUMNS = new Set([
  "supplier",
  "product",
  "sku",
  "status",
  "po_number",
  "condition",
  "description",
  "ship_date",
  "arrival",
  "updated",
  "created_at",
  "received_at",
  "reason_note",
  "velocity_note",
  "kind",
  "cost_source",
  "reliable",
]);

export function ReportResultView(props: {
  result: ReportResult;
  onFollowUp: (
    templateId: string,
    params: Record<string, string | number | boolean>,
  ) => void;
  onFollowUpPrompt?: (prompt: string) => void;
  followUpLoading?: boolean;
  onPin: () => void;
  pinning?: boolean;
  onSave?: () => void;
  saving?: boolean;
  saveTitle?: string;
  onSaveTitleChange?: (value: string) => void;
}) {
  const {
    result,
    onFollowUp,
    onFollowUpPrompt,
    followUpLoading,
    onPin,
    pinning,
    onSave,
    saving,
    saveTitle,
    onSaveTitleChange,
  } = props;
  const [followUp, setFollowUp] = useState("");

  const exportCsv = () => {
    downloadCsv(
      stampFilename(`report-${result.templateId}`),
      toCsv(result.columns, result.rows),
    );
  };

  const barSeries =
    result.chart &&
    (result.chart.type === "bar" || result.chart.type === "grouped_bar")
      ? result.chart.series.map((s) => ({
          name: s.name,
          data: s.data.map((d) => ({ key: d.key, value: d.value ?? 0 })),
        }))
      : null;

  const lineSeries =
    result.chart?.type === "line"
      ? result.chart.series.map((s) => ({
          name: s.name,
          data: s.data.map((d) => ({ key: d.key, value: d.value ?? 0 })),
        }))
      : null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" wrap>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {result.title}
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Computed in {result.timingMs}ms · narrated via{" "}
              {result.narrationSource}
              {result.matchExplanation
                ? ` · ${result.matchExplanation}`
                : ""}
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button onClick={exportCsv}>Export CSV</Button>
            <Button variant="primary" onClick={onPin} loading={pinning}>
              Pin to Dashboard
            </Button>
          </InlineStack>
        </InlineStack>

        <Text as="p" variant="bodyMd">
          {result.summary}
        </Text>
        {result.body ? (
          <Text as="p" tone="subdued" variant="bodyMd">
            {result.body}
          </Text>
        ) : null}

        {result.emptyReason ? (
          <Badge tone="attention">{result.emptyReason}</Badge>
        ) : null}

        {barSeries && barSeries.length ? (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {result.chart?.title}
            </Text>
            <div style={{ height: 280 }}>
              <BarChart data={barSeries} theme="Light" />
            </div>
          </BlockStack>
        ) : null}

        {lineSeries && lineSeries.length ? (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {result.chart?.title}
            </Text>
            <div style={{ height: 280 }}>
              <LineChart data={lineSeries} theme="Light" />
            </div>
          </BlockStack>
        ) : null}

        {result.rows.length ? (
          <DataTable
            columnContentTypes={result.columns.map((col, i) =>
              i === 0 || TEXT_COLUMNS.has(col) ? "text" : "numeric",
            )}
            headings={result.columns}
            rows={result.rows.map((row) =>
              row.map((cell) =>
                cell == null
                  ? "—"
                  : typeof cell === "number"
                    ? String(cell)
                    : cell,
              ),
            )}
          />
        ) : null}

        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Follow up
          </Text>
          {result.followUps.length ? (
            <InlineStack gap="200" wrap>
              {result.followUps.map((fu) => (
                <Button
                  key={fu.id}
                  onClick={() =>
                    onFollowUp(
                      fu.templateId,
                      fu.templateId === result.templateId
                        ? { ...(result.params ?? {}), ...fu.params }
                        : fu.params,
                    )
                  }
                >
                  {fu.label}
                </Button>
              ))}
            </InlineStack>
          ) : null}
          {onFollowUpPrompt ? (
            <BlockStack gap="200">
              <TextField
                label="Ask a follow-up"
                labelHidden
                value={followUp}
                onChange={setFollowUp}
                autoComplete="off"
                multiline={2}
                placeholder="e.g. Just show PO number, supplier, and total"
              />
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={() => {
                    const next = followUp.trim();
                    if (!next) return;
                    onFollowUpPrompt(next);
                    setFollowUp("");
                  }}
                  loading={followUpLoading}
                  disabled={!followUp.trim()}
                >
                  Ask follow-up
                </Button>
              </InlineStack>
            </BlockStack>
          ) : null}
        </BlockStack>

        {onSave ? (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Save for later
            </Text>
            <InlineStack gap="200" blockAlign="end" wrap>
              <div style={{ minWidth: 220, flexGrow: 1 }}>
                <TextField
                  label="Name"
                  value={saveTitle ?? ""}
                  onChange={onSaveTitleChange ?? (() => undefined)}
                  autoComplete="off"
                  placeholder={result.title}
                />
              </div>
              <Button onClick={onSave} loading={saving}>
                Save report
              </Button>
            </InlineStack>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}
