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
import { PolarisVizProvider } from "@shopify/polaris-viz";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisVizStyles from "@shopify/polaris-viz/build/esm/styles.css?url";

import {
  authenticate,
  billingIsTest,
  billingSkipAllowed,
  extractBillingError,
  isManagedPricingBlocked,
  isProductionRuntime,
  REQUISLY_PLAN,
  shopRequiresTestCharges,
} from "../shopify.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: polarisVizStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing } = await authenticate.admin(request);
  const developmentStore = await shopRequiresTestCharges(admin);
  // Live charges fail on partner/dev stores even when Vercel is production.
  const isTest = billingIsTest() || developmentStore;
  const skipBilling = billingSkipAllowed();

  let billingSkipped = false;
  let billingError: string | null = null;

  if (skipBilling) {
    // Preview/local QA only — billingSkipAllowed() refuses production runtimes.
    billingSkipped = true;
  } else {
    try {
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
    } catch (err) {
      // Successful billing.request redirects via a thrown Response — rethrow.
      if (err instanceof Response) throw err;

      const detail = extractBillingError(err);
      console.error("[billing] require/request failed:", detail, err);

      if (isManagedPricingBlocked(detail)) {
        // Partner Dashboard managed pricing owns the charge; Billing API cannot
        // create one. Shopify already gated install — do not 402 the shell.
      } else if (developmentStore || (isTest && !isProductionRuntime())) {
        // Dev/preview stores (Plus sandbox, Developer Preview) can still reject
        // even a test charge. Keep QA usable; production merchants still 402.
        billingSkipped = true;
        billingError = detail;
      } else {
        throw new Response(detail, { status: 402 });
      }
    }
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    billingSkipped,
    billingError,
  };
};

export default function App() {
  const { apiKey, billingSkipped, billingError } =
    useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <PolarisVizProvider>
        {/*
          App Bridge NavMenu only accepts text Links — no Icon / icon prop.
          Section headers use @shopify/polaris-icons instead (see SectionHeading).
        */}
        <NavMenu>
          <Link to="/app" rel="home">
            Today's Work
          </Link>
          <Link to="/app/purchase-orders">Purchase orders</Link>
          <Link to="/app/blankets">Blanket POs</Link>
          <Link to="/app/quote-requests">Quote requests</Link>
          <Link to="/app/purchase-orders/new">New PO</Link>
          <Link to="/app/templates">Templates</Link>
          <Link to="/app/suppliers">Suppliers</Link>
          <Link to="/app/products">Products</Link>
          <Link to="/app/reorder">Reorder</Link>
          <Link to="/app/manufacturing">Manufacturing</Link>
          <Link to="/app/warehouse">Warehouse</Link>
          <Link to="/app/calendar">Calendar</Link>
          <Link to="/app/analytics">Analytics</Link>
          <Link to="/app/reports">Report Builder</Link>
          <Link to="/app/settings/team">Team</Link>
          <Link to="/app/settings/notifications">Notifications</Link>
          <Link to="/app/settings/cogs">COGS</Link>
          <Link to="/app/settings/quickbooks">QuickBooks</Link>
        </NavMenu>
        {billingSkipped ? (
          <Box padding="400" paddingBlockEnd="0">
            <Banner tone="warning" title="Billing gate bypassed (dev)">
              <p>
                Shopify billing did not complete for this store
                {billingError ? `: ${billingError}` : ""}. App features are
                unlocked only because this is a test/dev session — production
                still requires an approved subscription.
              </p>
            </Banner>
          </Box>
        ) : null}
        <Outlet />
      </PolarisVizProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  // ErrorBoundary runs in the browser — never touch process.env here
  // (Vite has no Node `process` global → "process is not defined").
  const message = isRouteErrorResponse(error)
    ? error.data
      ? String(error.data)
      : `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Something went wrong";

  return (
    <AppProvider isEmbeddedApp apiKey="">
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
