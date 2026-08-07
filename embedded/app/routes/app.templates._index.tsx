import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  EmptyState,
  InlineGrid,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  archivePoTemplate,
  deletePoTemplate,
  duplicatePoTemplate,
  listPoTemplates,
  restorePoTemplate,
  type TemplateStatus,
} from "../lib/po-templates.server";
import { createServiceClient } from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const supplierId = url.searchParams.get("supplier");
  const status = (url.searchParams.get("status") ?? "active") as
    | TemplateStatus
    | "all";
  const sort = (url.searchParams.get("sort") ?? "last_used") as
    | "last_used"
    | "name"
    | "created";

  const supabase = createServiceClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", merchant.workspace.id)
    .order("name");

  const templates = await listPoTemplates(merchant.workspace.id, {
    q,
    supplierId,
    status,
    sort,
  });

  return {
    templates,
    suppliers: suppliers ?? [],
    filters: {
      q: q ?? "",
      supplierId: supplierId ?? "",
      status,
      sort,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const templateId = String(formData.get("template_id") ?? "");

  try {
    if (intent === "duplicate") {
      const copy = await duplicatePoTemplate({
        workspaceId: merchant.workspace.id,
        templateId,
        createdByLabel: merchant.shopName,
      });
      return merchant.redirect(`/app/templates/${copy.id}`);
    }
    if (intent === "archive") {
      await archivePoTemplate(merchant.workspace.id, templateId);
      return merchant.redirect("/app/templates");
    }
    if (intent === "restore") {
      await restorePoTemplate(merchant.workspace.id, templateId);
      return merchant.redirect("/app/templates?status=active");
    }
    if (intent === "delete") {
      await deletePoTemplate(merchant.workspace.id, templateId);
      return merchant.redirect("/app/templates");
    }
    return { error: "Unknown action" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Action failed",
    };
  }
};

export default function TemplatesIndex() {
  const { templates, suppliers, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [q, setQ] = useState(filters.q);

  function applyFilters(next: {
    q: string;
    supplier: string;
    status: string;
    sort: string;
  }) {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.supplier) params.set("supplier", next.supplier);
    if (next.status && next.status !== "active") params.set("status", next.status);
    if (next.sort && next.sort !== "last_used") params.set("sort", next.sort);
    setSearchParams(params);
  }

  return (
    <Page
      title="PO templates"
      subtitle="Reusable purchasing blueprints — draft faster, send sooner"
      primaryAction={{ content: "New template", url: "/app/templates/new" }}
      secondaryActions={[
        { content: "New PO", url: "/app/purchase-orders/new" },
      ]}
    >
      <TitleBar title="Templates" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineGrid columns={{ xs: 1, md: 4 }} gap="300">
              <TextField
                label="Search"
                labelHidden
                value={q}
                onChange={setQ}
                onBlur={() =>
                  applyFilters({
                    q,
                    supplier: filters.supplierId,
                    status: filters.status,
                    sort: filters.sort,
                  })
                }
                autoComplete="off"
                placeholder="Search name, supplier, or product"
              />
              <Select
                label="Supplier"
                labelHidden
                options={[
                  { label: "All suppliers", value: "" },
                  ...suppliers.map((s) => ({ label: s.name, value: s.id })),
                ]}
                value={filters.supplierId}
                onChange={(value) =>
                  applyFilters({
                    q: filters.q,
                    supplier: value,
                    status: filters.status,
                    sort: filters.sort,
                  })
                }
              />
              <Select
                label="Status"
                labelHidden
                options={[
                  { label: "Active", value: "active" },
                  { label: "Archived", value: "archived" },
                  { label: "All", value: "all" },
                ]}
                value={filters.status}
                onChange={(value) =>
                  applyFilters({
                    q: filters.q,
                    supplier: filters.supplierId,
                    status: value,
                    sort: filters.sort,
                  })
                }
              />
              <Select
                label="Sort"
                labelHidden
                options={[
                  { label: "Last used", value: "last_used" },
                  { label: "Name", value: "name" },
                  { label: "Recently created", value: "created" },
                ]}
                value={filters.sort}
                onChange={(value) =>
                  applyFilters({
                    q: filters.q,
                    supplier: filters.supplierId,
                    status: filters.status,
                    sort: value,
                  })
                }
              />
            </InlineGrid>
            <InlineStack align="end">
              <Button
                onClick={() =>
                  applyFilters({
                    q,
                    supplier: filters.supplierId,
                    status: filters.status,
                    sort: filters.sort,
                  })
                }
              >
                Search
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {templates.length === 0 ? (
          <Card>
            <EmptyState
              heading="No templates yet"
              action={{ content: "Create template", url: "/app/templates/new" }}
              secondaryAction={{
                content: "Start from a PO",
                url: "/app/purchase-orders",
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Save recurring orders as templates so next month’s PO takes
                seconds, not a rebuild.
              </p>
            </EmptyState>
          </Card>
        ) : (
          <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="400">
            {templates.map((template) => (
              <Card key={template.id}>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <InlineStack align="space-between" blockAlign="start" wrap>
                      <Text as="h2" variant="headingMd">
                        {template.name}
                      </Text>
                      {template.status === "archived" ? (
                        <Badge>Archived</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      {template.supplierName}
                    </Text>
                    {template.description ? (
                      <Text as="p" variant="bodySm">
                        {template.description}
                      </Text>
                    ) : null}
                  </BlockStack>

                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm">
                      {template.productCount} product
                      {template.productCount === 1 ? "" : "s"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Last used · {template.lastUsedLabel}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Created by {template.createdBy} · {template.createdLabel}
                    </Text>
                    {template.useCount > 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Used {template.useCount} time
                        {template.useCount === 1 ? "" : "s"}
                      </Text>
                    ) : null}
                  </BlockStack>

                  <ButtonGroup>
                    {template.status === "active" ? (
                      <Button
                        variant="primary"
                        url={`/app/purchase-orders/new?template=${template.id}`}
                      >
                        Use template
                      </Button>
                    ) : null}
                    <Button url={`/app/templates/${template.id}`}>Edit</Button>
                  </ButtonGroup>

                  <InlineStack gap="200" wrap>
                    <Form method="post">
                      <input type="hidden" name="intent" value="duplicate" />
                      <input
                        type="hidden"
                        name="template_id"
                        value={template.id}
                      />
                      <Button submit size="slim" disabled={busy}>
                        Duplicate
                      </Button>
                    </Form>
                    {template.status === "active" ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="archive" />
                        <input
                          type="hidden"
                          name="template_id"
                          value={template.id}
                        />
                        <Button submit size="slim" disabled={busy}>
                          Archive
                        </Button>
                      </Form>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="restore" />
                        <input
                          type="hidden"
                          name="template_id"
                          value={template.id}
                        />
                        <Button submit size="slim" disabled={busy}>
                          Restore
                        </Button>
                      </Form>
                    )}
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input
                        type="hidden"
                        name="template_id"
                        value={template.id}
                      />
                      <Button
                        submit
                        size="slim"
                        tone="critical"
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </Form>
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        )}

        {busy && navigation.formData ? (
          <Banner tone="info">
            <p>Updating templates…</p>
          </Banner>
        ) : null}
      </BlockStack>
    </Page>
  );
}
