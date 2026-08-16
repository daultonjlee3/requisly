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
  ChoiceList,
  EmptyState,
  Filters,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import {
  indexTablePagination,
  parseListPage,
  parseListQuery,
  patchListParams,
} from "../lib/list-table";
import { getMerchantContext } from "../lib/merchant.server";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";
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
  const q = parseListQuery(url.searchParams.get("q"));
  const page = parseListPage(url.searchParams.get("page"));
  const forExport = url.searchParams.get("export") === "1";
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
    .order("name")
    .limit(500);

  const result = await listPoTemplates(merchant.workspace.id, {
    q,
    supplierId,
    status,
    sort,
    ...(forExport ? { forExport: true } : { page }),
  });

  return {
    templates: result.rows,
    total: result.total,
    page,
    suppliers: suppliers ?? [],
    filters: {
      q,
      supplierId: supplierId ?? "",
      status,
      sort,
    },
    exportRows: forExport ? result.rows : null,
    exportToken: forExport ? Date.now() : null,
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
  const { templates, total, page, suppliers, filters } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [queryValue, setQueryValue] = useState(filters.q);
  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(patchListParams(searchParams, patch));
    },
    [searchParams, setSearchParams],
  );
  const { exportCsv, exporting } = useFilteredCsvExport({
    path: "/app/templates",
    searchParams,
    prefix: "templates",
    headers: ["name", "supplier", "status", "products", "last_used", "created"],
    mapRow: (t: (typeof templates)[number]) => [
      t.name,
      t.supplierName,
      t.status,
      t.productCount,
      t.lastUsedLabel,
      t.createdLabel,
    ],
  });

  const filterDefs = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "Active", value: "active" },
            { label: "Archived", value: "archived" },
            { label: "All", value: "all" },
          ]}
          selected={[filters.status]}
          onChange={(selected) =>
            applyParams({ status: selected[0] === "active" ? null : selected[0] ?? null })
          }
        />
      ),
      shortcut: true,
    },
    {
      key: "supplier",
      label: "Supplier",
      filter: (
        <ChoiceList
          title="Supplier"
          titleHidden
          choices={suppliers.map((s) => ({ label: s.name, value: s.id }))}
          selected={filters.supplierId ? [filters.supplierId] : []}
          onChange={(selected) =>
            applyParams({ supplier: selected[0] ?? null })
          }
        />
      ),
      shortcut: true,
    },
    {
      key: "sort",
      label: "Sort",
      filter: (
        <ChoiceList
          title="Sort"
          titleHidden
          choices={[
            { label: "Last used", value: "last_used" },
            { label: "Name", value: "name" },
            { label: "Recently created", value: "created" },
          ]}
          selected={[filters.sort]}
          onChange={(selected) =>
            applyParams({
              sort: selected[0] === "last_used" ? null : selected[0] ?? null,
            })
          }
        />
      ),
    },
  ];

  const appliedFilters = [
    ...(filters.status !== "active"
      ? [
          {
            key: "status",
            label: `Status: ${filters.status}`,
            onRemove: () => applyParams({ status: null }),
          },
        ]
      : []),
    ...(filters.supplierId
      ? [
          {
            key: "supplier",
            label: `Supplier: ${suppliers.find((s) => s.id === filters.supplierId)?.name ?? "Selected"}`,
            onRemove: () => applyParams({ supplier: null }),
          },
        ]
      : []),
  ];

  return (
    <Page
      title="PO templates"
      subtitle={`${total} template${total === 1 ? "" : "s"}`}
      primaryAction={{ content: "New template", url: "/app/templates/new" }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: total === 0 || exporting,
        },
        { content: "New PO", url: "/app/purchase-orders/new" },
      ]}
    >
      <TitleBar title="Templates" />
      <BlockStack gap="400">
        <Card padding="0">
          <Filters
            queryValue={queryValue}
            queryPlaceholder="Search name or supplier"
            filters={filterDefs}
            appliedFilters={appliedFilters}
            onQueryChange={setQueryValue}
            onQueryClear={() => {
              setQueryValue("");
              applyParams({ q: null });
            }}
            onQueryBlur={() => applyParams({ q: queryValue || null })}
            onClearAll={() => {
              setQueryValue("");
              applyParams({ q: null, supplier: null, status: null, sort: null });
            }}
          />
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
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "template", plural: "templates" }}
              itemCount={templates.length}
              headings={[
                { title: "Name" },
                { title: "Supplier" },
                { title: "Products" },
                { title: "Schedule" },
                { title: "Last used" },
                { title: "Status" },
                { title: "Actions" },
              ]}
              selectable={false}
              pagination={indexTablePagination({
                page,
                total,
                onPageChange: (next) => applyParams({ page: String(next) }),
              })}
            >
              {templates.map((template, index) => (
                <IndexTable.Row
                  id={template.id}
                  key={template.id}
                  position={index}
                >
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {template.name}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{template.supplierName}</IndexTable.Cell>
                  <IndexTable.Cell>{template.productCount}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {template.scheduleEnabled ? (
                      <Badge tone="info">{template.scheduleLabel}</Badge>
                    ) : (
                      <Text as="span" tone="subdued">
                        —
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{template.lastUsedLabel}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {template.status === "archived" ? (
                      <Badge>Archived</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" wrap>
                      <ButtonGroup>
                        {template.status === "active" ? (
                          <Button
                            size="slim"
                            variant="primary"
                            url={`/app/purchase-orders/new?template=${template.id}`}
                          >
                            Use
                          </Button>
                        ) : null}
                        <Button size="slim" url={`/app/templates/${template.id}`}>
                          Edit
                        </Button>
                      </ButtonGroup>
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
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
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
