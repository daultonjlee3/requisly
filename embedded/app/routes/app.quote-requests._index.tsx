import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getMerchantContext } from "../lib/merchant.server";
import { listQuoteRequests } from "../lib/quote-requests.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const rows = await listQuoteRequests(merchant.workspace.id);
  return { rows, workspaceName: merchant.workspace.name };
};

function statusTone(
  status: string,
): "success" | "attention" | "info" | "critical" | undefined {
  if (status === "awarded") return "success";
  if (status === "responded" || status === "partially_responded")
    return "attention";
  if (status === "cancelled") return "critical";
  return "info";
}

export default function QuoteRequestsIndex() {
  const { rows, workspaceName } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Quote requests"
      subtitle={workspaceName}
      primaryAction={{
        content: "New quote request",
        url: "/app/quote-requests/new",
      }}
    >
      <TitleBar title="Quote requests" />
      <Card padding="0">
        {rows.length === 0 ? (
          <Box padding="400">
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Request quotes from multiple suppliers, compare responses, then
                award lines into draft POs.
              </Text>
              <Button url="/app/quote-requests/new" variant="primary">
                New quote request
              </Button>
            </BlockStack>
          </Box>
        ) : (
          <IndexTable
            resourceName={{ singular: "request", plural: "requests" }}
            itemCount={rows.length}
            headings={[
              { title: "Title" },
              { title: "Status" },
              { title: "Suppliers" },
              { title: "Lines" },
            ]}
            selectable={false}
          >
            {rows.map((row, index) => (
              <IndexTable.Row id={row.id} key={row.id} position={index}>
                <IndexTable.Cell>
                  <Link to={`/app/quote-requests/${row.id}`}>
                    <Text as="span" fontWeight="semibold">
                      {row.title}
                    </Text>
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {row.responseCount}/{row.supplierCount} responded
                </IndexTable.Cell>
                <IndexTable.Cell>{row.lineCount}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
