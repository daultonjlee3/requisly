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
import { downloadCsv, stampFilename, toCsv } from "../lib/csv";
import type { ReportResult } from "../lib/report-builder.server";

export function ReportResultView(props: {
  result: ReportResult;
  onFollowUp: (
    templateId: string,
    params: Record<string, string | number | boolean>,
  ) => void;
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
    onPin,
    pinning,
    onSave,
    saving,
    saveTitle,
    onSaveTitleChange,
  } = props;

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
            columnContentTypes={result.columns.map((_, i) =>
              i === 0 ? "text" : "numeric",
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

        {result.followUps.length ? (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Follow up
            </Text>
            <InlineStack gap="200" wrap>
              {result.followUps.map((fu) => (
                <Button
                  key={fu.id}
                  onClick={() => onFollowUp(fu.templateId, fu.params)}
                >
                  {fu.label}
                </Button>
              ))}
            </InlineStack>
          </BlockStack>
        ) : null}

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
