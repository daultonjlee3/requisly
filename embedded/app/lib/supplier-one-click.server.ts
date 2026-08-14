import { createServiceClient } from "./supabase.server";
import { randomToken } from "./format";

export type OneClickAction = "confirm_as_is" | "mark_shipped";

const TOKEN_TTL_DAYS = 30;

function linkBaseUrl() {
  return (
    process.env.SUPPLIER_LINK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/$/, "");
}

export type OneClickUrls = {
  confirmAsIsUrl: string | null;
  markShippedUrl: string | null;
};

/** Issue fresh single-use one-click tokens for a PO email send. Prior unused tokens for this PO are invalidated. */
export async function issueOneClickTokens(opts: {
  workspaceId: string;
  poId: string;
  shipDate: string | null;
}): Promise<OneClickUrls> {
  const supabase = createServiceClient();
  const base = linkBaseUrl();
  const expiresAt = new Date(
    Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await supabase
    .from("supplier_one_click_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("po_id", opts.poId)
    .is("used_at", null);

  const actions: Array<{ action: OneClickAction; shipDate: string | null }> = [
    { action: "confirm_as_is", shipDate: opts.shipDate },
    { action: "mark_shipped", shipDate: null },
  ];

  const urls: OneClickUrls = {
    confirmAsIsUrl: null,
    markShippedUrl: null,
  };

  for (const row of actions) {
    const token = randomToken(24);
    const { error } = await supabase.from("supplier_one_click_tokens").insert({
      workspace_id: opts.workspaceId,
      po_id: opts.poId,
      token,
      action: row.action,
      ship_date: row.shipDate,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);
    const url = base ? `${base}/a/${token}` : null;
    if (row.action === "confirm_as_is") urls.confirmAsIsUrl = url;
    else urls.markShippedUrl = url;
  }

  return urls;
}
