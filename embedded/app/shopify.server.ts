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

type GraphqlAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Test Billing API charges from env.
 * Defaults to true outside production. Hard-refuses production so a stray
 * SHOPIFY_BILLING_TEST=true cannot create test charges on real merchants.
 * Development / partner stores still use test charges via shopRequiresTestCharges().
 */
export function billingIsTest() {
  if (isProductionRuntime()) return false;
  if (process.env.SHOPIFY_BILLING_TEST === "true") return true;
  if (process.env.SHOPIFY_BILLING_TEST === "false") return false;
  return true;
}

/**
 * Partner development stores (and Shopify "Developer Preview" shops) cannot
 * accept a live charge. Production Vercel must still use isTest: true for them,
 * or billing.request throws "Error while billing the store" and the app shell 402s.
 */
export async function shopRequiresTestCharges(
  admin: GraphqlAdmin,
): Promise<boolean> {
  try {
    const res = await admin.graphql(
      `#graphql
      query RequislyShopBillingPlan {
        shop {
          plan {
            partnerDevelopment
            displayName
          }
        }
      }`,
    );
    const json = (await res.json()) as {
      data?: {
        shop?: {
          plan?: { partnerDevelopment?: boolean; displayName?: string };
        };
      };
    };
    const plan = json.data?.shop?.plan;
    if (!plan) return false;
    if (plan.partnerDevelopment) return true;
    const name = (plan.displayName ?? "").toLowerCase();
    return (
      name === "developer preview" ||
      name === "development" ||
      name.includes("plus partner sandbox") ||
      name.includes("partner sandbox")
    );
  } catch (err) {
    console.error("[billing] shop plan lookup failed:", err);
    return false;
  }
}

/** Shopify's helper message is generic; userErrors live on errorData. */
export function extractBillingError(err: unknown): string {
  if (err && typeof err === "object") {
    const rec = err as {
      message?: string;
      errorData?: unknown;
      billingErrors?: unknown;
    };
    const raw = rec.errorData ?? rec.billingErrors;
    const chunks: string[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") chunks.push(item);
        else if (item && typeof item === "object" && "message" in item) {
          chunks.push(String((item as { message: unknown }).message));
        }
      }
    }
    if (chunks.length) return chunks.join("; ");
    if (rec.message) return rec.message;
  }
  return err instanceof Error ? err.message : "Error while billing the store";
}

export function isManagedPricingBlocked(detail: string): boolean {
  return (
    /managed pricing/i.test(detail) ||
    /public distribution/i.test(detail) ||
    /cannot use the Billing API/i.test(detail)
  );
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
