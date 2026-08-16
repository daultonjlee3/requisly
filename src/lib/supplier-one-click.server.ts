import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyConfirmedEmailParse,
  type EmailParsePayload,
} from "@/lib/po-inbound-reply.server";

export type OneClickAction =
  | "confirm_as_is"
  | "mark_shipped"
  | "confirm_email_parse";

export type OneClickPreview = {
  token: string;
  action: OneClickAction;
  actionLabel: string;
  poNumber: string;
  workspaceName: string;
  supplierName: string;
  shipDate: string | null;
  supplierLinkUrl: string | null;
  expired: boolean;
  used: boolean;
};

export type OneClickRedeemResult =
  | {
      ok: true;
      actionLabel: string;
      poNumber: string;
      supplierLinkUrl: string | null;
      message: string;
    }
  | {
      ok: false;
      error: string;
      supplierLinkUrl: string | null;
    };

function actionLabel(action: OneClickAction): string {
  if (action === "confirm_as_is") return "Confirm as-is";
  if (action === "confirm_email_parse") return "Confirm this interpretation";
  return "Mark shipped";
}

function supplierLinkUrlFromToken(linkToken: string | null): string | null {
  if (!linkToken) return null;
  const base = (
    process.env.SUPPLIER_LINK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/$/, "");
  return base ? `${base}/s/${linkToken}` : null;
}

async function loadOneClickContext(token: string) {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("supplier_one_click_tokens")
    .select(
      "id, token, action, ship_date, expires_at, used_at, po_id, workspace_id, payload",
    )
    .eq("token", token)
    .maybeSingle();
  if (error || !row) return null;

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("po_number, suppliers(name)")
    .eq("id", row.po_id)
    .maybeSingle();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", row.workspace_id)
    .maybeSingle();

  const { data: link } = await supabase
    .from("supplier_link_tokens")
    .select("token")
    .eq("po_id", row.po_id)
    .maybeSingle();

  return {
    id: row.id as string,
    token: row.token as string,
    action: row.action as OneClickAction,
    payload: (row.payload as EmailParsePayload | null) ?? null,
    ship_date: row.ship_date as string | null,
    expires_at: row.expires_at as string,
    used_at: row.used_at as string | null,
    po_id: row.po_id as string,
    po_number: String(po?.po_number ?? "PO"),
    supplier_name:
      (po?.suppliers as unknown as { name: string } | null)?.name?.trim() ||
      "Supplier",
    workspace_name: workspace?.name?.trim() || "Merchant",
    link_token: (link?.token as string | null) ?? null,
  };
}

export async function getOneClickPreview(
  token: string,
): Promise<OneClickPreview | null> {
  const ctx = await loadOneClickContext(token);
  if (!ctx) return null;
  const expired = new Date(ctx.expires_at).getTime() < Date.now();
  return {
    token: ctx.token,
    action: ctx.action,
    actionLabel: actionLabel(ctx.action),
    poNumber: ctx.po_number,
    workspaceName: ctx.workspace_name,
    supplierName: ctx.supplier_name,
    shipDate: ctx.ship_date,
    supplierLinkUrl: supplierLinkUrlFromToken(ctx.link_token),
    expired,
    used: Boolean(ctx.used_at),
  };
}

export async function redeemOneClickToken(
  token: string,
): Promise<OneClickRedeemResult> {
  const ctx = await loadOneClickContext(token);
  if (!ctx) {
    return { ok: false, error: "This link is invalid.", supplierLinkUrl: null };
  }

  const fullUrl = supplierLinkUrlFromToken(ctx.link_token);
  if (!ctx.link_token) {
    return {
      ok: false,
      error: "Supplier Link is missing for this order.",
      supplierLinkUrl: null,
    };
  }
  if (ctx.used_at) {
    return {
      ok: false,
      error: "This one-click link was already used.",
      supplierLinkUrl: fullUrl,
    };
  }
  if (new Date(ctx.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      error: "This one-click link has expired.",
      supplierLinkUrl: fullUrl,
    };
  }

  const supabase = createAdminClient();

  // Claim token first (single-use). If concurrent, only one wins.
  const { data: claimed, error: claimError } = await supabase
    .from("supplier_one_click_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", ctx.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    return {
      ok: false,
      error: claimError.message,
      supplierLinkUrl: fullUrl,
    };
  }
  if (!claimed) {
    return {
      ok: false,
      error: "This one-click link was already used.",
      supplierLinkUrl: fullUrl,
    };
  }

  try {
    if (ctx.action === "confirm_email_parse") {
      if (!ctx.payload) {
        throw new Error("This confirmation link is missing its interpretation.");
      }
      await applyConfirmedEmailParse({
        linkToken: ctx.link_token,
        poId: ctx.po_id,
        payload: ctx.payload,
      });
      return {
        ok: true,
        actionLabel: actionLabel(ctx.action),
        poNumber: ctx.po_number,
        supplierLinkUrl: fullUrl,
        message: "Your reply was applied.",
      };
    }

    if (ctx.action === "confirm_as_is") {
      const { error } = await supabase.rpc("supplier_link_confirm", {
        p_token: ctx.link_token,
        p_ship_date: ctx.ship_date,
      });
      if (error) throw new Error(error.message);
      return {
        ok: true,
        actionLabel: actionLabel(ctx.action),
        poNumber: ctx.po_number,
        supplierLinkUrl: fullUrl,
        message: "Order confirmed as-is.",
      };
    }

    const { error } = await supabase.rpc("supplier_link_add_shipment", {
      p_token: ctx.link_token,
      p_tracking: null,
      p_carrier: null,
      p_estimated_arrival_date: null,
      p_note: "Marked shipped via one-click email link",
      p_lines: [],
    });
    if (error) throw new Error(error.message);
    return {
      ok: true,
      actionLabel: actionLabel(ctx.action),
      poNumber: ctx.po_number,
      supplierLinkUrl: fullUrl,
      message: "Shipment recorded.",
    };
  } catch (e) {
    // Allow retry if the business RPC failed after claim.
    await supabase
      .from("supplier_one_click_tokens")
      .update({ used_at: null })
      .eq("id", ctx.id);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Action failed",
      supplierLinkUrl: fullUrl,
    };
  }
}
