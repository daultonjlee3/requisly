import { createClient } from "@supabase/supabase-js";

const ALLOWED_RPCS = new Set([
  "supplier_link_confirm",
  "supplier_link_add_shipment",
  "supplier_link_ship",
  "supplier_link_reject",
  "supplier_link_propose_changes",
]);

function publicRpcClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase is not configured");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function openSupplierLink(token: string): Promise<{
  data: unknown | null;
  error: string | null;
}> {
  try {
    const supabase = publicRpcClient();
    const { data, error } = await supabase.rpc("supplier_link_open", {
      p_token: token,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not open this link.",
    };
  }
}

export async function runSupplierLinkRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown | null; error: string | null }> {
  if (!ALLOWED_RPCS.has(name)) {
    return { data: null, error: "Unsupported action." };
  }
  try {
    const supabase = publicRpcClient();
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Action failed.",
    };
  }
}
