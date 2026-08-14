import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { ChartVerticalIcon, SaveIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { ReportResultView } from "../components/ReportResultView";
import { SectionHeading } from "../components/SectionHeading";
import { getMerchantContext } from "../lib/merchant.server";
import {
  appInstallationHasOrdersScope,
  sessionHasOrdersScope,
  syncShopifyOrdersGraphql,
} from "../lib/orders-sync.server";
import { mapPromptToReportTemplate } from "../lib/report-prompt.server";
import {
  REPORT_TEMPLATES,
  deleteSavedReport,
  listSavedReports,
  pinReportToDashboard,
  runReportTemplate,
  saveReportDefinition,
  type ReportResult,
  type SavedReportRow,
} from "../lib/report-builder.server";
import { startTimer } from "../lib/timing.server";

type ActionPayload = {
  error: string | null;
  needsOrdersScope: boolean;
  result: ReportResult | null;
  pinnedId: string | null;
  savedId: string | null;
  matchExplanation: string | null;
  sync?: { orders: number; lineItems: number };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const timer = startTimer("loader:/app/reports");
  const merchant = await getMerchantContext(request, { sync: false });
  const hasOrdersScope =
    sessionHasOrdersScope(merchant.session.scope) ||
    (await appInstallationHasOrdersScope(merchant.admin));
  const starters = REPORT_TEMPLATES.filter((t) => t.starter);
  const savedReports = await listSavedReports(merchant.workspace.id);
  const storeHandle = merchant.shopDomain
    .replace(/\.myshopify\.com$/i, "")
    .toLowerCase();
  timer.end({ hasOrdersScope, saved: savedReports.length });
  return {
    workspaceName: merchant.workspace.name,
    shopDomain: merchant.shopDomain,
    storeHandle,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    hasOrdersScope,
    ordersSyncedAt: (merchant.workspace as { orders_synced_at?: string | null })
      .orders_synced_at ?? null,
    starters,
    savedReports,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const timer = startTimer("action:/app/reports");
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const hasOrdersScope =
    sessionHasOrdersScope(merchant.session.scope) ||
    (await appInstallationHasOrdersScope(merchant.admin));

  const empty: ActionPayload = {
    error: null,
    needsOrdersScope: false,
    result: null,
    pinnedId: null,
    savedId: null,
    matchExplanation: null,
  };

  try {
    if (intent === "sync_orders") {
      if (!hasOrdersScope) {
        timer.end({ intent, missingScope: true });
        return {
          ...empty,
          error: "Orders scope missing — grant read_orders from the banner.",
          needsOrdersScope: true,
        };
      }
      const sync = await syncShopifyOrdersGraphql({
        admin: merchant.admin,
        workspaceId: merchant.workspace.id,
      });
      timer.end({ intent, orders: sync.orders });
      return {
        ...empty,
        error: sync.skippedMissingScope
          ? "Shopify denied Orders access — grant read_orders from the banner."
          : null,
        needsOrdersScope: sync.skippedMissingScope,
        sync,
      };
    }

    if (intent === "run_prompt") {
      const prompt = String(form.get("prompt") ?? "").trim();
      const match = await mapPromptToReportTemplate(prompt);
      if (!match.templateId) {
        timer.end({ intent, unmatched: true });
        return {
          ...empty,
          error: match.explanation,
          matchExplanation: match.explanation,
        };
      }
      const result = await runReportTemplate({
        workspaceId: merchant.workspace.id,
        templateId: match.templateId,
        params: match.params,
      });
      result.prompt = prompt;
      result.matchExplanation = match.explanation;
      result.params = match.params;
      const meta = REPORT_TEMPLATES.find((t) => t.id === match.templateId);
      timer.end({ intent, templateId: match.templateId, ms: result.timingMs });
      return {
        ...empty,
        needsOrdersScope:
          Boolean(meta?.needsOrders) && !hasOrdersScope,
        result,
        matchExplanation: match.explanation,
      };
    }

    if (intent === "run") {
      const templateId = String(form.get("templateId") ?? "");
      const paramsRaw = String(form.get("params") ?? "{}");
      let params: Record<string, string | number | boolean> = {};
      try {
        params = JSON.parse(paramsRaw) as Record<
          string,
          string | number | boolean
        >;
      } catch {
        params = {};
      }
      const promptOverride = String(form.get("prompt") ?? "").trim();
      const meta = REPORT_TEMPLATES.find((t) => t.id === templateId);
      const result = await runReportTemplate({
        workspaceId: merchant.workspace.id,
        templateId,
        params,
      });
      result.prompt = promptOverride || meta?.question || null;
      result.params = params;
      timer.end({ intent, templateId, ms: result.timingMs });
      return {
        ...empty,
        needsOrdersScope: Boolean(meta?.needsOrders) && !hasOrdersScope,
        result,
      };
    }

    if (intent === "save") {
      const title = String(form.get("title") ?? "").trim();
      const prompt = String(form.get("prompt") ?? "").trim();
      const templateId = String(form.get("templateId") ?? "");
      const paramsRaw = String(form.get("params") ?? "{}");
      let params: Record<string, string | number | boolean> = {};
      try {
        params = JSON.parse(paramsRaw) as Record<
          string,
          string | number | boolean
        >;
      } catch {
        params = {};
      }
      const saved = await saveReportDefinition({
        workspaceId: merchant.workspace.id,
        title: title || prompt || "Saved report",
        prompt: prompt || title,
        templateId,
        params,
      });
      // Keep showing the last result if client re-posted it
      let result: ReportResult | null = null;
      const resultRaw = String(form.get("result_json") ?? "");
      if (resultRaw) {
        try {
          result = JSON.parse(resultRaw) as ReportResult;
        } catch {
          result = null;
        }
      }
      timer.end({ intent: "save" });
      return {
        ...empty,
        result,
        savedId: saved.id,
      };
    }

    if (intent === "delete_saved") {
      const id = String(form.get("id") ?? "");
      await deleteSavedReport({
        workspaceId: merchant.workspace.id,
        id,
      });
      timer.end({ intent: "delete_saved" });
      return empty;
    }

    if (intent === "pin") {
      const payload = String(form.get("result_json") ?? "");
      const result = JSON.parse(payload) as ReportResult;
      const pinnedId = await pinReportToDashboard({
        workspaceId: merchant.workspace.id,
        result,
      });
      timer.end({ intent: "pin" });
      return {
        ...empty,
        result,
        pinnedId,
      };
    }

    return { ...empty, error: "Unknown action" };
  } catch (err) {
    timer.end({ intent, error: true });
    return {
      ...empty,
      error: err instanceof Error ? err.message : "Report failed",
    };
  }
};

type ScopesApi = {
  request: (
    scopes: string[],
  ) => Promise<{ result: "granted-all" | "declined-all" }>;
};

export default function ReportsPage() {
  const {
    workspaceName,
    hasOrdersScope,
    starters,
    storeHandle,
    apiKey,
    savedReports,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [requestingScope, setRequestingScope] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [saveTitle, setSaveTitle] = useState("");

  const runningPrompt =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "run_prompt";
  const running =
    navigation.state !== "idle" &&
    (navigation.formData?.get("intent") === "run" || runningPrompt);
  const pinning =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "pin";
  const saving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "save";
  const syncing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "sync_orders";

  const requestOrdersScope = useCallback(async () => {
    setRequestingScope(true);
    try {
      const scopesApi = (shopify as unknown as { scopes?: ScopesApi }).scopes;
      if (scopesApi?.request) {
        const response = await scopesApi.request(["read_orders"]);
        if (response.result === "granted-all") {
          revalidator.revalidate();
        }
        return;
      }
      if (apiKey && storeHandle) {
        const url = `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/oauth/install?client_id=${encodeURIComponent(apiKey)}&optional_scopes=read_orders`;
        open(url, "_top");
      }
    } catch (err) {
      console.error("[reports] scopes.request failed", err);
      if (apiKey && storeHandle) {
        const url = `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/oauth/install?client_id=${encodeURIComponent(apiKey)}&optional_scopes=read_orders`;
        open(url, "_top");
      }
    } finally {
      setRequestingScope(false);
    }
  }, [apiKey, revalidator, shopify, storeHandle]);

  const runTemplate = useCallback(
    (
      templateId: string,
      params: Record<string, string | number | boolean> = {},
      promptText?: string,
    ) => {
      const fd = new FormData();
      fd.set("intent", "run");
      fd.set("templateId", templateId);
      fd.set("params", JSON.stringify(params));
      if (promptText) fd.set("prompt", promptText);
      submit(fd, { method: "post" });
    },
    [submit],
  );

  const runPrompt = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "run_prompt");
    fd.set("prompt", prompt);
    submit(fd, { method: "post" });
  }, [prompt, submit]);

  const pin = useCallback(() => {
    if (!actionData?.result) return;
    const fd = new FormData();
    fd.set("intent", "pin");
    fd.set("result_json", JSON.stringify(actionData.result));
    submit(fd, { method: "post" });
  }, [actionData?.result, submit]);

  const save = useCallback(() => {
    if (!actionData?.result) return;
    const result = actionData.result;
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set(
      "title",
      saveTitle.trim() || result.title || result.prompt || "Saved report",
    );
    fd.set("prompt", result.prompt || result.title);
    fd.set("templateId", result.templateId);
    fd.set("params", JSON.stringify(result.params ?? {}));
    fd.set("result_json", JSON.stringify(result));
    submit(fd, { method: "post" });
  }, [actionData?.result, saveTitle, submit]);

  const deleteSaved = useCallback(
    (id: string) => {
      const fd = new FormData();
      fd.set("intent", "delete_saved");
      fd.set("id", id);
      submit(fd, { method: "post" });
    },
    [submit],
  );

  return (
    <Page
      title="Report Builder"
      subtitle={`${workspaceName} · cross-join PO, catalog, and order facts`}
    >
      <TitleBar title="Report Builder" />
      <BlockStack gap="500">
        {!hasOrdersScope || actionData?.needsOrdersScope ? (
          <Banner
            tone="warning"
            title="Orders access needed for revenue reports"
            action={{
              content: requestingScope
                ? "Requesting…"
                : "Grant Orders access",
              onAction: requestOrdersScope,
              loading: requestingScope,
              disabled: requestingScope,
            }}
          >
            <p>
              Grant <Text as="span" fontWeight="semibold">read_orders</Text> so
              Requisly can sync a read-only Orders cache. Spend and margin
              reports still work from PO + catalog data without it.
            </p>
          </Banner>
        ) : (
          <InlineStack align="end">
            <Form method="post">
              <input type="hidden" name="intent" value="sync_orders" />
              <Button submit loading={syncing}>
                Sync recent orders
              </Button>
            </Form>
          </InlineStack>
        )}

        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {actionData?.savedId ? (
          <Banner tone="success" title="Report saved">
            <p>It&apos;s in Your saved reports below — re-run anytime.</p>
          </Banner>
        ) : null}

        {actionData?.pinnedId ? (
          <Banner tone="success" title="Pinned to Today's Work">
            <p>
              Your report is on the dashboard — dismiss anytime like other
              insights.
            </p>
          </Banner>
        ) : null}

        {"sync" in (actionData ?? {}) && actionData && "sync" in actionData ? (
          <Banner tone="success" title="Orders synced">
            <p>
              {(actionData as { sync?: { orders: number; lineItems: number } })
                .sync?.orders ?? 0}{" "}
              orders ·{" "}
              {(actionData as { sync?: { orders: number; lineItems: number } })
                .sync?.lineItems ?? 0}{" "}
              line items
            </p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="400">
            <SectionHeading
              title="Start with the questions only Requisly can answer"
              icon={ChartVerticalIcon}
              subtitle="Every number is computed in code first — Claude only narrates finished facts. Never raw SQL from the model."
            />
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              {starters.map((t) => (
                <Card key={t.id}>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      {t.question}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {t.blurb}
                      {t.needsOrders ? " · uses Orders when synced" : ""}
                    </Text>
                    <Button
                      variant="primary"
                      onClick={() => runTemplate(t.id, {}, t.question)}
                      loading={
                        running &&
                        navigation.formData?.get("templateId") === t.id
                      }
                    >
                      Run report
                    </Button>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <SectionHeading
              title="Ask your own question"
              icon={ChartVerticalIcon}
              subtitle="We map your wording onto a built-in template — never invent SQL. Thresholds like “below 30%” become filters."
            />
            <TextField
              label="Your question"
              labelHidden
              value={prompt}
              onChange={setPrompt}
              autoComplete="off"
              multiline={2}
              placeholder="e.g. Show suppliers with margin below 25%"
            />
            <InlineStack align="end">
              <Button
                variant="primary"
                onClick={runPrompt}
                loading={runningPrompt}
                disabled={!prompt.trim()}
              >
                Run my question
              </Button>
            </InlineStack>
            {actionData?.matchExplanation && actionData?.result ? (
              <Text as="p" tone="subdued" variant="bodySm">
                {actionData.matchExplanation}
              </Text>
            ) : null}
          </BlockStack>
        </Card>

        {savedReports.length ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeading
                title="Your saved reports"
                icon={SaveIcon}
                subtitle="Re-run with current data — same template and filters you saved."
              />
              <BlockStack gap="200">
                {(savedReports as SavedReportRow[]).map((sr) => (
                  <InlineStack
                    key={sr.id}
                    align="space-between"
                    blockAlign="center"
                    wrap
                    gap="200"
                  >
                    <BlockStack gap="100">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {sr.title}
                      </Text>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {sr.prompt}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button
                        onClick={() =>
                          runTemplate(sr.template_id, sr.params ?? {}, sr.prompt)
                        }
                        loading={
                          running &&
                          navigation.formData?.get("templateId") ===
                            sr.template_id &&
                          navigation.formData?.get("prompt") === sr.prompt
                        }
                      >
                        Run
                      </Button>
                      <Button
                        tone="critical"
                        variant="plain"
                        onClick={() => deleteSaved(sr.id)}
                      >
                        Delete
                      </Button>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        ) : null}

        {actionData?.result ? (
          <ReportResultView
            result={actionData.result}
            onFollowUp={runTemplate}
            onPin={pin}
            pinning={pinning}
            onSave={save}
            saving={saving}
            saveTitle={saveTitle}
            onSaveTitleChange={setSaveTitle}
          />
        ) : null}
      </BlockStack>
    </Page>
  );
}
