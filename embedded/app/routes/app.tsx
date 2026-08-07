import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import {
  isRouteErrorResponse,
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import {
  Banner,
  BlockStack,
  Box,
  Card,
  Page,
  Text,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import {
  authenticate,
  billingIsTest,
  REQUISLY_PLAN,
} from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const isTest = billingIsTest();

  // Block all app features until the merchant approves the charge (trial counts).
  await billing.require({
    plans: [REQUISLY_PLAN],
    isTest,
    onFailure: async () =>
      billing.request({
        plan: REQUISLY_PLAN,
        isTest,
        trialDays: 14,
      }),
  });

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Today's Work
        </Link>
        <Link to="/app/purchase-orders">Purchase orders</Link>
        <Link to="/app/purchase-orders/new">New PO</Link>
        <Link to="/app/templates">Templates</Link>
        <Link to="/app/suppliers">Suppliers</Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/calendar">Calendar</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/settings/notifications">Notifications</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.data
      ? String(error.data)
      : `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Something went wrong";

  return (
    <AppProvider isEmbeddedApp apiKey={process.env.SHOPIFY_API_KEY || ""}>
      <Page title="Something went wrong">
        <Box paddingBlockStart="400">
          <Card>
            <BlockStack gap="300">
              <Banner tone="critical" title="This page couldn’t load">
                <p>{message}</p>
              </Banner>
              <Text as="p" tone="subdued">
                Try reopening Requisly from Shopify Admin. Sync or database
                failures should never leave a blank screen.
              </Text>
            </BlockStack>
          </Card>
        </Box>
      </Page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
