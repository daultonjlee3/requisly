import { Session } from "@shopify/shopify-api";

import { createServiceClient } from "./supabase.server";

/**
 * Shopify session store over Supabase HTTP (service role).
 * Prisma TCP to the transaction pooler times out from Vercel and 410s Admin.
 */
type SessionRow = {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope: string | null;
  expires: string | null;
  accessToken: string;
  userId: number | string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  accountOwner: boolean;
  locale: string | null;
  collaborator: boolean | null;
  emailVerified: boolean | null;
  refreshToken: string | null;
  refreshTokenExpires: string | null;
};

export class SupabaseSessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    const { error } = await createServiceClient()
      .from("Session")
      .upsert(sessionToRow(session));
    if (error) {
      console.error("[session] store failed:", error.message);
      throw error;
    }
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const { data, error } = await createServiceClient()
      .from("Session")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[session] load failed:", error.message);
      throw error;
    }
    if (!data) return undefined;
    return rowToSession(data as SessionRow);
  }

  async deleteSession(id: string): Promise<boolean> {
    const { error } = await createServiceClient()
      .from("Session")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("[session] delete failed:", error.message);
      return false;
    }
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const { error } = await createServiceClient()
      .from("Session")
      .delete()
      .in("id", ids);
    if (error) {
      console.error("[session] deleteMany failed:", error.message);
      return false;
    }
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const { data, error } = await createServiceClient()
      .from("Session")
      .select("*")
      .eq("shop", shop)
      .order("expires", { ascending: false })
      .limit(25);
    if (error) {
      console.error("[session] findByShop failed:", error.message);
      throw error;
    }
    return ((data as SessionRow[]) ?? []).map(rowToSession);
  }
}

function sessionToRow(session: Session): SessionRow {
  const params = session.toObject();
  return {
    id: session.id,
    shop: session.shop,
    state: session.state,
    isOnline: session.isOnline,
    scope: session.scope || null,
    expires: session.expires ? session.expires.toISOString() : null,
    accessToken: session.accessToken || "",
    userId: params.onlineAccessInfo?.associated_user.id ?? null,
    firstName: params.onlineAccessInfo?.associated_user.first_name || null,
    lastName: params.onlineAccessInfo?.associated_user.last_name || null,
    email: params.onlineAccessInfo?.associated_user.email || null,
    accountOwner:
      params.onlineAccessInfo?.associated_user.account_owner || false,
    locale: params.onlineAccessInfo?.associated_user.locale || null,
    collaborator:
      params.onlineAccessInfo?.associated_user.collaborator ?? false,
    emailVerified:
      params.onlineAccessInfo?.associated_user.email_verified ?? false,
    refreshToken: params.refreshToken || null,
    refreshTokenExpires: params.refreshTokenExpires
      ? new Date(params.refreshTokenExpires).toISOString()
      : null,
  };
}

function rowToSession(row: SessionRow): Session {
  const sessionParams: Record<string, boolean | string | number> = {
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: row.isOnline,
    userId: String(row.userId ?? ""),
    firstName: String(row.firstName ?? ""),
    lastName: String(row.lastName ?? ""),
    email: String(row.email ?? ""),
    locale: String(row.locale ?? ""),
  };

  if (row.accountOwner !== null) sessionParams.accountOwner = row.accountOwner;
  if (row.collaborator !== null) sessionParams.collaborator = row.collaborator;
  if (row.emailVerified !== null)
    sessionParams.emailVerified = row.emailVerified;
  if (row.expires) sessionParams.expires = new Date(row.expires).getTime();
  if (row.scope) sessionParams.scope = row.scope;
  if (row.accessToken) sessionParams.accessToken = row.accessToken;
  if (row.refreshToken) sessionParams.refreshToken = row.refreshToken;
  if (row.refreshTokenExpires) {
    sessionParams.refreshTokenExpires = new Date(
      row.refreshTokenExpires,
    ).getTime();
  }

  return Session.fromPropertyArray(Object.entries(sessionParams), true);
}
