import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

/** Single flat plan — everything included, no tiers. */
export const REQUISLY_PLAN = "Requisly";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [REQUISLY_PLAN]: {
      trialDays: 14,
      lineItems: [
        {
          amount: 99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  future: {
    // Token-exchange embedded auth (session tokens → offline access token).
    unstable_newEmbeddedAuthStrategy: true,
    // Required for apps created after 2026-04-01: expiring offline tokens + refresh.
    // Prisma Session stores refreshToken / refreshTokenExpires; PrismaSessionStorage
    // rotates accessToken via the refresh grant when expires is past.
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

/**
 * Test Billing API charges.
 * Defaults to true outside production. Hard-refuses production so a stray
 * SHOPIFY_BILLING_TEST=true cannot create test charges or trip the
 * "continue without subscription" failure path in app.tsx.
 */
export function billingIsTest() {
  if (isProductionRuntime()) return false;
  if (process.env.SHOPIFY_BILLING_TEST === "true") return true;
  if (process.env.SHOPIFY_BILLING_TEST === "false") return false;
  return true;
}

/** True for Vercel production or NODE_ENV=production (non-preview). */
export function isProductionRuntime() {
  if (process.env.VERCEL_ENV === "production") return true;
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

/**
 * Billing gate bypass — LOCAL / preview QA only.
 * Hard-refuses when VERCEL_ENV=production or NODE_ENV=production.
 * Setting SHOPIFY_SKIP_BILLING=true on the production project is a no-op.
 */
export function billingSkipAllowed() {
  if (isProductionRuntime()) return false;
  return process.env.SHOPIFY_SKIP_BILLING === "true";
}
