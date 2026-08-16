import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type QboOauthStatePayload = {
  workspaceId: string;
  shop: string;
  nonce: string;
  ts: number;
};

export function signQboOauthState(
  payload: Omit<QboOauthStatePayload, "nonce" | "ts"> & {
    nonce?: string;
    ts?: number;
  },
  secret: string,
): string {
  const full: QboOauthStatePayload = {
    workspaceId: payload.workspaceId,
    shop: payload.shop,
    nonce: payload.nonce ?? randomBytes(16).toString("hex"),
    ts: payload.ts ?? Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyQboOauthState(
  state: string,
  secret: string,
  opts?: { maxAgeMs?: number; now?: number },
): QboOauthStatePayload {
  const maxAgeMs = opts?.maxAgeMs ?? 15 * 60 * 1000;
  const now = opts?.now ?? Date.now();
  const dot = state.lastIndexOf(".");
  if (dot <= 0) throw new Error("QuickBooks sign-in state is invalid.");
  const encoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error("QuickBooks sign-in state is invalid.");
  }
  let payload: QboOauthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as QboOauthStatePayload;
  } catch {
    throw new Error("QuickBooks sign-in state is invalid.");
  }
  if (!payload.workspaceId || !payload.shop || !payload.nonce || !payload.ts) {
    throw new Error("QuickBooks sign-in state is invalid.");
  }
  if (Math.abs(now - payload.ts) > maxAgeMs) {
    throw new Error("QuickBooks sign-in expired. Start Connect again from Settings.");
  }
  return payload;
}
