import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Service-role client for the embedded merchant app.
 * Auth is Shopify session tokens — RLS is bypassed; every query must be scoped by workspace_id.
 *
 * Boundary: SUPABASE_SERVICE_ROLE_KEY is read only in this `.server.ts` module.
 * Remix excludes `*.server.ts` from the browser bundle. Never import this file
 * from a client component or any non-`.server` module that could ship to the browser.
 */
export function createServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY for the embedded app.",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
