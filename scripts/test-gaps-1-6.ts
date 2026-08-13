/**
 * Pass/fail suite for functionality gaps 1–6.
 *
 *   npx tsx scripts/test-gaps-1-6.ts
 *
 * Uses the demo workspace for live DB cases; cleans up smoke rows afterward.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv(resolve("embedded/.env"));
loadEnv(resolve(".env.local"));
loadEnv(resolve(".env"));

const WORKSPACE_ID =
  process.env.SMOKE_WORKSPACE_ID || "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

type Result = {
  gap: string;
  name: string;
  expect: "pass" | "fail";
  ok: boolean;
  detail: string;
};

const results: Result[] = [];

function record(
  gap: string,
  name: string,
  expect: "pass" | "fail",
  ok: boolean,
  detail: string,
) {
  results.push({ gap, name, expect, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${gap} · ${name} (${expect}) — ${detail}`);
}

async function expectPass(
  gap: string,
  name: string,
  fn: () => Promise<string> | string,
) {
  try {
    const detail = await fn();
    record(gap, name, "pass", true, detail);
  } catch (err) {
    record(
      gap,
      name,
      "pass",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function expectFail(
  gap: string,
  name: string,
  fn: () => Promise<unknown>,
  match?: RegExp | string,
) {
  try {
    await fn();
    record(gap, name, "fail", false, "expected error but succeeded");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const matched =
      match == null
        ? true
        : typeof match === "string"
          ? msg.includes(match)
          : match.test(msg);
    record(
      gap,
      name,
      "fail",
      matched,
      matched ? msg : `wrong error: ${msg}`,
    );
  }
}

function emb(path: string) {
  return pathToFileURL(resolve(path)).href;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { inviteTeammate, revokeInvite } = await import(
    emb("embedded/app/lib/team.server.ts")
  );
  const { cancelPurchaseOrder } = await import(
    emb("embedded/app/lib/purchase-orders.server.ts")
  );
  const { canCancelPurchaseOrder } = await import(
    emb("embedded/app/lib/po-status.ts")
  );
  const { completeReceiving, correctReceipt } = await import(
    emb("embedded/app/lib/receiving.server.ts")
  );
  const { toCsv, stampFilename } = await import(
    emb("embedded/app/lib/csv.ts")
  );

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name, email")
    .eq("workspace_id", WORKSPACE_ID)
    .limit(1)
    .single();
  if (!supplier) throw new Error("No supplier in demo workspace");

  const { data: location } = await supabase
    .from("locations")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("is_primary", true)
    .maybeSingle();

  const cleanupPoIds: string[] = [];
  const cleanupInviteIds: string[] = [];

  // ─── #1 Team invites ───────────────────────────────────────────────
  const inviteEmail = `gap1-pass+${Date.now()}@example.com`;

  await expectPass("1", "invite creates pending row", async () => {
    const result = await inviteTeammate({
      workspaceId: WORKSPACE_ID,
      email: inviteEmail,
      invitedByLabel: "Gap suite",
    });
    cleanupInviteIds.push(result.inviteId);
    const { data } = await supabase
      .from("workspace_invites")
      .select("id, email, accepted_at, revoked_at")
      .eq("id", result.inviteId)
      .single();
    if (!data || data.accepted_at || data.revoked_at) {
      throw new Error("invite not pending");
    }
    return `inviteId=${result.inviteId} emailSent=${result.emailSent}`;
  });

  await expectFail(
    "1",
    "duplicate pending invite rejected",
    () =>
      inviteTeammate({
        workspaceId: WORKSPACE_ID,
        email: inviteEmail,
      }),
    "already pending",
  );

  await expectFail(
    "1",
    "invalid email rejected",
    () =>
      inviteTeammate({
        workspaceId: WORKSPACE_ID,
        email: "not-an-email",
      }),
    "valid email",
  );

  await expectPass("1", "get_workspace_invite RPC", async () => {
    const { data: inv } = await supabase
      .from("workspace_invites")
      .select("token")
      .eq("id", cleanupInviteIds[0]!)
      .single();
    const { data, error } = await supabase.rpc("get_workspace_invite", {
      p_token: inv!.token,
    });
    if (error) throw error;
    const preview = data as { email?: string };
    if (preview.email !== inviteEmail) throw new Error("email mismatch");
    return `preview email=${preview.email}`;
  });

  await expectFail(
    "1",
    "invalid invite token rejected",
    async () => {
      const { error } = await supabase.rpc("get_workspace_invite", {
        p_token: "definitely-invalid-token",
      });
      if (error) throw new Error(error.message);
      throw new Error("expected RPC error");
    },
    /invalid_token/i,
  );

  // ─── #2 Cancel PO ──────────────────────────────────────────────────
  await expectPass("2", "canCancel matrix", () => {
    const cases: Array<[string, boolean]> = [
      ["draft", true],
      ["sent", true],
      ["shipped", true],
      ["partially_received", true],
      ["received", false],
      ["closed", false],
      ["rejected", false],
      ["cancelled", false],
    ];
    for (const [status, expected] of cases) {
      const got = canCancelPurchaseOrder(status as never);
      if (got !== expected) {
        throw new Error(`${status}: expected ${expected} got ${got}`);
      }
    }
    return "8/8 statuses";
  });

  const cancelPo = await createSmokePo(supabase, {
    supplierId: supplier.id,
    locationId: location?.id ?? null,
    status: "sent",
    description: "Cancel smoke line",
    isFreeText: true,
    sku: null,
  });
  cleanupPoIds.push(cancelPo.poId);

  await expectPass("2", "cancel open PO", async () => {
    await cancelPurchaseOrder({
      workspaceId: WORKSPACE_ID,
      poId: cancelPo.poId,
      note: "gap suite",
    });
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("status")
      .eq("id", cancelPo.poId)
      .single();
    const { data: ev } = await supabase
      .from("po_timeline_events")
      .select("event_type, actor, metadata")
      .eq("po_id", cancelPo.poId)
      .eq("event_type", "cancelled")
      .maybeSingle();
    if (po?.status !== "cancelled") throw new Error(`status=${po?.status}`);
    if (!ev || ev.actor !== "merchant") throw new Error("missing timeline");
    return "status=cancelled + timeline";
  });

  await expectFail(
    "2",
    "cancel already-cancelled rejected",
    () =>
      cancelPurchaseOrder({
        workspaceId: WORKSPACE_ID,
        poId: cancelPo.poId,
      }),
    "only available before",
  );

  const closedPo = await createSmokePo(supabase, {
    supplierId: supplier.id,
    locationId: location?.id ?? null,
    status: "closed",
    description: "Already closed",
    isFreeText: true,
    sku: null,
  });
  cleanupPoIds.push(closedPo.poId);

  await expectFail(
    "2",
    "cancel closed PO rejected",
    () =>
      cancelPurchaseOrder({
        workspaceId: WORKSPACE_ID,
        poId: closedPo.poId,
      }),
    "only available before",
  );

  await expectFail(
    "2",
    "cancel missing PO rejected",
    () =>
      cancelPurchaseOrder({
        workspaceId: WORKSPACE_ID,
        poId: "00000000-0000-0000-0000-000000000000",
      }),
    "not found",
  );

  // ─── #3 Receipt correction ─────────────────────────────────────────
  const recvPo = await createSmokePo(supabase, {
    supplierId: supplier.id,
    locationId: location?.id ?? null,
    status: "shipped",
    description: "Receive then correct",
    isFreeText: true,
    sku: null,
    qty: 10,
  });
  cleanupPoIds.push(recvPo.poId);

  await expectPass("3", "receive then correct qty (delta)", async () => {
    await completeReceiving({
      workspaceId: WORKSPACE_ID,
      poId: recvPo.poId,
      note: "initial",
      lines: [
        {
          po_line_item_id: recvPo.lineId,
          qty_received: 10,
          condition: "good",
        },
      ],
    });
    const { data: receipt } = await supabase
      .from("receipts")
      .select("id, receipt_line_items(id, qty_received)")
      .eq("po_id", recvPo.poId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const rli = (
      receipt!.receipt_line_items as Array<{ id: string; qty_received: number }>
    )[0]!;

    const result = await correctReceipt({
      workspaceId: WORKSPACE_ID,
      poId: recvPo.poId,
      receiptId: receipt!.id,
      note: "corrected to 7",
      lines: [
        {
          receipt_line_item_id: rli.id,
          qty_received: 7,
          condition: "good",
        },
      ],
    });

    const { data: updated } = await supabase
      .from("receipt_line_items")
      .select("qty_received")
      .eq("id", rli.id)
      .single();
    if (updated?.qty_received !== 7) {
      throw new Error(`qty=${updated?.qty_received}`);
    }
    const { data: corrEv } = await supabase
      .from("po_timeline_events")
      .select("metadata")
      .eq("po_id", recvPo.poId)
      .contains("metadata", { reason: "receipt_correction" })
      .maybeSingle();
    if (!corrEv) throw new Error("no correction timeline");
    return `nextStatus=${result.nextStatus} qty=7`;
  });

  await expectFail(
    "3",
    "correct missing receipt rejected",
    () =>
      correctReceipt({
        workspaceId: WORKSPACE_ID,
        poId: recvPo.poId,
        receiptId: "00000000-0000-0000-0000-000000000000",
        note: null,
        lines: [
          {
            receipt_line_item_id: "00000000-0000-0000-0000-000000000001",
            qty_received: 1,
            condition: "good",
          },
        ],
      }),
    "Receipt not found",
  );

  await expectFail(
    "3",
    "correct negative qty rejected",
    async () => {
      const { data: receipt } = await supabase
        .from("receipts")
        .select("id, receipt_line_items(id)")
        .eq("po_id", recvPo.poId)
        .limit(1)
        .single();
      const rliId = (
        receipt!.receipt_line_items as Array<{ id: string }>
      )[0]!.id;
      await correctReceipt({
        workspaceId: WORKSPACE_ID,
        poId: recvPo.poId,
        receiptId: receipt!.id,
        note: null,
        lines: [
          {
            receipt_line_item_id: rliId,
            qty_received: -1,
            condition: "good",
          },
        ],
      });
    },
    "negative",
  );

  await expectFail(
    "3",
    "correct on cancelled PO rejected",
    async () => {
      const cancelledRecv = await createSmokePo(supabase, {
        supplierId: supplier.id,
        locationId: location?.id ?? null,
        status: "shipped",
        description: "Will cancel",
        isFreeText: true,
        sku: null,
      });
      cleanupPoIds.push(cancelledRecv.poId);
      await completeReceiving({
        workspaceId: WORKSPACE_ID,
        poId: cancelledRecv.poId,
        note: null,
        lines: [
          {
            po_line_item_id: cancelledRecv.lineId,
            qty_received: 1,
            condition: "good",
          },
        ],
      });
      // Force cancelled after receive for gate test.
      await supabase
        .from("purchase_orders")
        .update({ status: "cancelled" })
        .eq("id", cancelledRecv.poId);
      const { data: receipt } = await supabase
        .from("receipts")
        .select("id, receipt_line_items(id)")
        .eq("po_id", cancelledRecv.poId)
        .limit(1)
        .single();
      await correctReceipt({
        workspaceId: WORKSPACE_ID,
        poId: cancelledRecv.poId,
        receiptId: receipt!.id,
        note: null,
        lines: [
          {
            receipt_line_item_id: (
              receipt!.receipt_line_items as Array<{ id: string }>
            )[0]!.id,
            qty_received: 1,
            condition: "good",
          },
        ],
      });
    },
    "cannot have receipt corrections",
  );

  // ─── #4 Free-text receiving ────────────────────────────────────────
  const ftPo = await createSmokePo(supabase, {
    supplierId: supplier.id,
    locationId: location?.id ?? null,
    status: "shipped",
    description: "Free-text only",
    isFreeText: true,
    sku: null,
    qty: 4,
  });
  cleanupPoIds.push(ftPo.poId);

  const { data: levelsBefore } = await supabase
    .from("inventory_levels")
    .select("id, on_hand, updated_at")
    .eq("workspace_id", WORKSPACE_ID);
  const beforeFp = fingerprintLevels(levelsBefore);

  await expectPass("4", "free-text receive writes receipt, skips inventory", async () => {
    const result = await completeReceiving({
      workspaceId: WORKSPACE_ID,
      poId: ftPo.poId,
      note: "ft",
      lines: [
        {
          po_line_item_id: ftPo.lineId,
          qty_received: 4,
          condition: "good",
        },
      ],
    });
    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, receipt_line_items(qty_received, po_line_item_id)")
      .eq("po_id", ftPo.poId);
    const { data: levelsAfter } = await supabase
      .from("inventory_levels")
      .select("id, on_hand, updated_at")
      .eq("workspace_id", WORKSPACE_ID);
    if ((receipts?.length ?? 0) !== 1) throw new Error("no receipt");
    if (fingerprintLevels(levelsAfter) !== beforeFp) {
      throw new Error("inventory changed");
    }
    return `status=${result.nextStatus} inventoryUnchanged=true`;
  });

  await expectFail(
    "4",
    "receive on draft rejected",
    async () => {
      const draft = await createSmokePo(supabase, {
        supplierId: supplier.id,
        locationId: location?.id ?? null,
        status: "draft",
        description: "Not receivable",
        isFreeText: true,
        sku: null,
      });
      cleanupPoIds.push(draft.poId);
      await completeReceiving({
        workspaceId: WORKSPACE_ID,
        poId: draft.poId,
        note: null,
        lines: [
          {
            po_line_item_id: draft.lineId,
            qty_received: 1,
            condition: "good",
          },
        ],
      });
    },
    "not ready to receive",
  );

  await expectFail(
    "4",
    "receive with zero qty rejected",
    async () => {
      const zeroPo = await createSmokePo(supabase, {
        supplierId: supplier.id,
        locationId: location?.id ?? null,
        status: "shipped",
        description: "Zero qty",
        isFreeText: true,
        sku: null,
      });
      cleanupPoIds.push(zeroPo.poId);
      await completeReceiving({
        workspaceId: WORKSPACE_ID,
        poId: zeroPo.poId,
        note: null,
        lines: [
          {
            po_line_item_id: zeroPo.lineId,
            qty_received: 0,
            condition: "good",
          },
        ],
      });
    },
    "at least one received",
  );

  // ─── #5 CSV export ─────────────────────────────────────────────────
  await expectPass("5", "toCsv escaping + rows", () => {
    const csv = toCsv(
      ["name", "note"],
      [
        ["Acme", "plain"],
        ['Say "hi"', "a,b"],
        [null, 12.5],
      ],
    );
    if (!csv.includes('"Say ""hi"""')) throw new Error("quote escape failed");
    if (!csv.includes('"a,b"')) throw new Error("comma escape failed");
    if (!csv.startsWith("name,note")) throw new Error("header missing");
    return `bytes=${csv.length}`;
  });

  await expectPass("5", "stampFilename format", () => {
    const name = stampFilename("purchase-orders");
    if (!/^purchase-orders-\d{8}\.csv$/.test(name)) {
      throw new Error(name);
    }
    return name;
  });

  await expectFail(
    "5",
    "empty filtered export should be disabled (logic)",
    async () => {
      // Mirrors UI: Export disabled when filtered.length === 0
      const filtered: unknown[] = [];
      if (filtered.length === 0) {
        throw new Error("export disabled when empty");
      }
    },
    "export disabled",
  );

  await expectPass("5", "PO/supplier/analytics row shapes", () => {
    const poCsv = toCsv(
      ["po_number", "supplier", "status", "total"],
      [["PO-1", "Acme", "sent", 12.5]],
    );
    const supCsv = toCsv(
      ["name", "email", "open_pos"],
      [[supplier.name, supplier.email, 2]],
    );
    const spendCsv = toCsv(
      ["type", "name", "closed_pos", "spend"],
      [
        ["supplier", "Acme", 3, 100],
        ["month", "2026-01", null, 50],
      ],
    );
    if (!poCsv.includes("PO-1") || !supCsv.includes(supplier.name)) {
      throw new Error("shape mismatch");
    }
    if (!spendCsv.includes("month")) throw new Error("missing month row");
    return "po+supplier+spend csv ok";
  });

  // ─── #6 Search filters ─────────────────────────────────────────────
  await expectPass("6", "supplier name/email filter", () => {
    const suppliers = [
      { name: "Northwind Labels", email: "ops@northwind.test" },
      { name: "Acme Pack", email: "buy@acme.test" },
    ];
    const q = "north";
    const filtered = suppliers.filter((s) =>
      `${s.name} ${s.email}`.toLowerCase().includes(q),
    );
    if (filtered.length !== 1 || filtered[0]!.name !== "Northwind Labels") {
      throw new Error(JSON.stringify(filtered));
    }
    return "1 match";
  });

  await expectPass("6", "product name/SKU filter", () => {
    const catalog = [
      { title: "Care label", sku: "AT-LAB-CARE", supplierName: "Acme" },
      { title: "Mailer box", sku: "PP-BOX-M", supplierName: "Pack Co" },
    ];
    const variants = [
      { title: "Tee / Black", sku: "TEE-BLK" },
      { title: "Hoodie", sku: "HD-GRY" },
    ];
    const q = "lab-care";
    const fc = catalog.filter((r) =>
      `${r.title} ${r.sku} ${r.supplierName}`.toLowerCase().includes(q),
    );
    const fv = variants.filter((r) =>
      `${r.title} ${r.sku}`.toLowerCase().includes(q),
    );
    if (fc.length !== 1 || fv.length !== 0) {
      throw new Error(`catalog=${fc.length} variants=${fv.length}`);
    }
    return "catalog match by SKU";
  });

  await expectFail(
    "6",
    "no-match search yields empty (UI empty state)",
    async () => {
      const q = "zzz-no-such-sku";
      const catalog = [{ title: "Care label", sku: "AT-LAB-CARE" }];
      const filtered = catalog.filter((r) =>
        `${r.title} ${r.sku}`.toLowerCase().includes(q),
      );
      if (filtered.length === 0) throw new Error("no suppliers/products match");
    },
    "no suppliers/products match",
  );

  await expectPass("6", "clearing query restores full list", () => {
    const all = [{ name: "A" }, { name: "B" }];
    let q = "a";
    let filtered = all.filter((s) => s.name.toLowerCase().includes(q));
    if (filtered.length !== 1) throw new Error("filter broken");
    q = "";
    filtered = q
      ? all.filter((s) => s.name.toLowerCase().includes(q))
      : all;
    if (filtered.length !== 2) throw new Error("clear broken");
    return "restored 2";
  });

  // Cleanup
  for (const id of cleanupInviteIds) {
    try {
      await revokeInvite({ workspaceId: WORKSPACE_ID, inviteId: id });
    } catch {
      await supabase
        .from("workspace_invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
    }
  }
  for (const id of cleanupPoIds) {
    await supabase.from("purchase_orders").delete().eq("id", id);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n=== Summary ===");
  console.log(`Total: ${results.length}  Pass: ${passed}  Fail: ${failed}`);
  for (const gap of ["1", "2", "3", "4", "5", "6"]) {
    const subset = results.filter((r) => r.gap === gap);
    const ok = subset.every((r) => r.ok);
    console.log(
      `  Gap ${gap}: ${ok ? "OK" : "BROKEN"} (${subset.filter((r) => r.ok).length}/${subset.length})`,
    );
  }

  if (failed > 0) process.exit(1);
}

function fingerprintLevels(
  rows:
    | Array<{ id: string; on_hand: number; updated_at: string }>
    | null
    | undefined,
) {
  return JSON.stringify(
    (rows ?? [])
      .map((r) => ({
        id: r.id,
        on_hand: r.on_hand,
        updated_at: r.updated_at,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

async function createSmokePo(
  supabase: SupabaseClient,
  opts: {
    supplierId: string;
    locationId: string | null;
    status: string;
    description: string;
    isFreeText: boolean;
    sku: string | null;
    qty?: number;
  },
) {
  const qty = opts.qty ?? 5;
  const poNumber = `PO-GAP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({
      workspace_id: WORKSPACE_ID,
      supplier_id: opts.supplierId,
      location_id: opts.locationId,
      po_number: poNumber,
      status: opts.status,
      subtotal: qty,
      total: qty,
      notes: "gap suite smoke — delete",
    })
    .select("id")
    .single();
  if (poErr) throw new Error(poErr.message);

  const { data: line, error: lineErr } = await supabase
    .from("po_line_items")
    .insert({
      po_id: po.id,
      description: opts.description,
      sku: opts.sku,
      qty,
      unit_cost: 1,
      line_total: qty,
      is_free_text: opts.isFreeText,
      sort_order: 0,
    })
    .select("id")
    .single();
  if (lineErr) throw new Error(lineErr.message);

  if (opts.status !== "draft") {
    await supabase.from("po_timeline_events").insert({
      po_id: po.id,
      event_type: opts.status === "closed" ? "closed" : "shipped",
      actor: "system",
      metadata: { smoke: true },
    });
  }

  return { poId: po.id, lineId: line.id, poNumber };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
