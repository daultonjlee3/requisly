import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_RPCS = new Set([
  "supplier_link_confirm",
  "supplier_link_add_shipment",
  "supplier_link_ship",
  "supplier_link_reject",
  "supplier_link_propose_changes",
]);

function publicError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Could not open this link.";
  if (
    /supabase is not configured/i.test(message) ||
    /missing next_public_supabase_url/i.test(message) ||
    /supabase_service_role_key/i.test(message)
  ) {
    console.error("[supplier-link] missing Supabase env on this host:", message);
    return "This link could not be opened right now.";
  }
  return message;
}

export async function openSupplierLink(token: string): Promise<{
  data: unknown | null;
  error: string | null;
}> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("supplier_link_open", {
      p_token: token,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: publicError(err) };
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
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: publicError(err) };
  }
}
