import { createServiceClient } from "./supabase.server";
import { money } from "./format";
import {
  assertQuickBooksPushGate,
  type ThreeWayMatch,
} from "./three-way-match";
import { getPurchaseOrderDetail } from "./purchase-orders.server";
import {
  buildBillPayload,
  matchQboVendor,
  qboItemCreateName,
  roundMoney,
  suggestedLineMappingType,
  varianceExtra,
  type QboMappingMode,
  type QboNamedRef,
} from "./quickbooks-map";
import {
  QboApiError,
  QboReconnectNeededError,
  billDeepLink,
  createQboBill,
  createQboItem,
  createQboVendor,
  getProductItemMappings,
  getQboAppConfig,
  getQboConnection,
  getQboSettings,
  getSupplierVendorMapping,
  listQboExpenseAccounts,
  listQboItems,
  listQboVendors,
  saveProductItemMapping,
  saveQboSettings,
  saveSupplierVendorMapping,
  type QboConnection,
  type QboSettings,
} from "./quickbooks.server";

export type QboPushLinePreview = {
  id: string;
  description: string;
  sku: string;
  qty: number;
  unitCost: number;
  amount: number;
  isFreeText: boolean;
  supplierProductId: string | null;
  mappingType: QboMappingMode;
  mappedItem: QboNamedRef | null;
};

export type QboPushPreview = {
  po: {
    id: string;
    poNumber: string;
    status: string;
    statusLabel: string;
    supplierId: string;
    supplierName: string;
    invoiceAmount: number | null;
    poTotal: number;
    taxAmount: number;
    shippingAmount: number;
    adjustmentAmount: number;
    qbPushedAt: string | null;
    qbBillId: string | null;
    qbBillUrl: string | null;
  };
  match: ThreeWayMatch;
  gate: ReturnType<typeof assertQuickBooksPushGate>;
  config: {
    configured: boolean;
    missing: string[];
    env: "sandbox" | "production";
    redirectUri: string;
  };
  connection: QboConnection;
  settings: QboSettings;
  vendor: {
    mapped: QboNamedRef | null;
    exact: QboNamedRef | null;
    suggestions: Array<QboNamedRef & { score: number }>;
    vendors: QboNamedRef[];
  };
  accounts: QboNamedRef[];
  items: QboNamedRef[];
  lines: QboPushLinePreview[];
  catalogError: string | null;
};

export type QboPushResult = {
  pushed: boolean;
  alreadySynced: boolean;
  summary: string;
  billId: string | null;
  billUrl: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadQboPushPreview(
  workspaceId: string,
  poId: string,
): Promise<QboPushPreview | null> {
  const po = await getPurchaseOrderDetail(workspaceId, poId);
  if (!po) return null;

  const config = getQboAppConfig();
  const [connection, settings] = await Promise.all([
    getQboConnection(workspaceId),
    getQboSettings(workspaceId),
  ]);

  const gate = assertQuickBooksPushGate({
    status: po.status,
    hasInvoice: po.threeWayMatch.hasInvoice,
    hasDiscrepancy: po.threeWayMatch.hasDiscrepancy,
    acknowledged: true,
    alreadyPushed: Boolean(po.qbPushedAt),
  });

  const preview: QboPushPreview = {
    po: {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      statusLabel: po.statusLabel,
      supplierId: po.supplier.id,
      supplierName: po.supplier.name,
      invoiceAmount: po.invoiceAmountRaw,
      poTotal: po.threeWayMatch.poTotal,
      taxAmount: po.taxAmountRaw,
      shippingAmount: po.shippingAmountRaw,
      adjustmentAmount: po.adjustmentAmountRaw,
      qbPushedAt: po.qbPushedAt,
      qbBillId: po.qbBillId,
      qbBillUrl: po.qbBillId ? billDeepLink(po.qbBillId) : null,
    },
    match: po.threeWayMatch,
    gate,
    config: {
      configured: config.configured,
      missing: config.missing,
      env: config.env,
      redirectUri: config.redirectUri,
    },
    connection,
    settings,
    vendor: {
      mapped: null,
      exact: null,
      suggestions: [],
      vendors: [],
    },
    accounts: [],
    items: [],
    lines: po.lineItems.map((line) => ({
      id: line.id,
      description: line.description,
      sku: line.sku,
      qty: line.qtyRaw,
      unitCost: line.unitCostRaw,
      amount: roundMoney(line.qtyRaw * line.unitCostRaw),
      isFreeText: line.isFreeText,
      supplierProductId: line.supplierProductId,
      mappingType: suggestedLineMappingType({
        isFreeText: line.isFreeText,
        mappingMode: settings.mappingMode,
      }),
      mappedItem: null,
    })),
    catalogError: null,
  };

  if (!config.configured || !connection.connected || connection.reconnectNeeded) {
    return preview;
  }

  try {
    const productIds = preview.lines
      .map((line) => line.supplierProductId)
      .filter((id): id is string => Boolean(id));
    const [vendors, accounts, items, mappedVendor, itemMaps] = await Promise.all([
      listQboVendors(workspaceId),
      listQboExpenseAccounts(workspaceId),
      listQboItems(workspaceId),
      getSupplierVendorMapping(workspaceId, po.supplier.id),
      getProductItemMappings(workspaceId, productIds),
    ]);
    const match = matchQboVendor(po.supplier.name, vendors);
    preview.vendor = {
      mapped: mappedVendor,
      exact: match.exact,
      suggestions: match.suggestions,
      vendors,
    };
    preview.accounts = accounts;
    preview.items = items;
    preview.lines = preview.lines.map((line) => ({
      ...line,
      mappedItem: line.supplierProductId
        ? itemMaps.get(line.supplierProductId) ?? null
        : null,
    }));
  } catch (err) {
    preview.catalogError =
      err instanceof Error ? err.message : "Could not load QuickBooks lists.";
  }

  return preview;
}

type LineChoice = {
  id: string;
  mappingType: QboMappingMode;
  qboId: string;
  create: boolean;
};

function parseLineChoices(raw: string): LineChoice[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Line mapping payload is invalid.");
  return parsed.map((row) => {
    const record = row as Record<string, unknown>;
    const mappingType = record.mappingType === "item" ? "item" : "account";
    return {
      id: String(record.id ?? ""),
      mappingType,
      qboId: String(record.qboId ?? "").trim(),
      create: record.create === true,
    };
  });
}

export async function confirmQboPush(opts: {
  workspaceId: string;
  poId: string;
  acknowledgeDiscrepancy: boolean;
  force: boolean;
  vendorChoice: "mapped" | "existing" | "create";
  vendorId: string;
  defaultAccountId: string;
  linesJson: string;
}): Promise<QboPushResult> {
  const po = await getPurchaseOrderDetail(opts.workspaceId, opts.poId);
  if (!po) throw new Error("Purchase order not found");

  const gate = assertQuickBooksPushGate({
    status: po.status,
    hasInvoice: po.threeWayMatch.hasInvoice,
    hasDiscrepancy: po.threeWayMatch.hasDiscrepancy,
    acknowledged: opts.acknowledgeDiscrepancy,
    alreadyPushed: Boolean(po.qbPushedAt),
    force: opts.force,
  });
  if (!gate.ok) {
    throw new Error(
      gate.alreadySynced
        ? "Already pushed to QuickBooks. Use Push again anyway if you intend a second bill."
        : `${gate.reason}${po.threeWayMatch.hasDiscrepancy ? ` ${po.threeWayMatch.summary}` : ""}`,
    );
  }

  const config = getQboAppConfig();
  if (!config.configured) {
    throw new Error(
      `QuickBooks is not configured on this app (missing ${config.missing.join(", ")}).`,
    );
  }

  const connection = await getQboConnection(opts.workspaceId);
  if (!connection.connected || connection.reconnectNeeded) {
    throw new QboReconnectNeededError();
  }

  const settings = await getQboSettings(opts.workspaceId);
  const [accounts, items] = await Promise.all([
    listQboExpenseAccounts(opts.workspaceId),
    listQboItems(opts.workspaceId),
  ]);
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const itemById = new Map(items.map((row) => [row.id, row]));

  const defaultAccount =
    accountById.get(opts.defaultAccountId) ??
    (settings.defaultExpenseAccountId
      ? accountById.get(settings.defaultExpenseAccountId)
      : undefined) ??
    null;
  if (!defaultAccount) {
    throw new Error("Choose a default expense or COGS account before pushing.");
  }
  if (
    defaultAccount.id !== settings.defaultExpenseAccountId ||
    defaultAccount.name !== settings.defaultExpenseAccountName
  ) {
    await saveQboSettings(opts.workspaceId, {
      defaultExpenseAccountId: defaultAccount.id,
      defaultExpenseAccountName: defaultAccount.name,
    });
  }

  let vendor: QboNamedRef;
  if (opts.vendorChoice === "create") {
    vendor = await createQboVendor(opts.workspaceId, po.supplier.name);
  } else if (opts.vendorChoice === "mapped") {
    const mapped = await getSupplierVendorMapping(
      opts.workspaceId,
      po.supplier.id,
    );
    if (!mapped) throw new Error("No stored QuickBooks vendor mapping for this supplier.");
    vendor = mapped;
  } else {
    const vendors = await listQboVendors(opts.workspaceId);
    const found = vendors.find((row) => row.id === opts.vendorId);
    if (!found) throw new Error("Choose a QuickBooks vendor, or create a new one.");
    vendor = found;
  }
  await saveSupplierVendorMapping({
    workspaceId: opts.workspaceId,
    supplierId: po.supplier.id,
    vendor,
  });

  const choices = parseLineChoices(opts.linesJson);
  const choiceById = new Map(choices.map((row) => [row.id, row]));
  const billLines = [];

  for (const line of po.lineItems) {
    const choice = choiceById.get(line.id);
    const mappingType = line.isFreeText
      ? "account"
      : choice?.mappingType ?? settings.mappingMode;
    if (line.isFreeText && mappingType !== "account") {
      throw new Error("Free-text line items always post to the default expense account.");
    }

    if (mappingType === "item") {
      let item: QboNamedRef | null = null;
      if (choice?.create) {
        item = await createQboItem(opts.workspaceId, {
          name: qboItemCreateName(line.description, line.sku === "—" ? null : line.sku),
          expenseAccountId: defaultAccount.id,
        });
      } else if (choice?.qboId) {
        item = itemById.get(choice.qboId) ?? null;
      }
      if (!item) {
        throw new Error(
          `Choose or create a QuickBooks item for “${line.description}”.`,
        );
      }
      if (line.supplierProductId) {
        await saveProductItemMapping({
          workspaceId: opts.workspaceId,
          supplierProductId: line.supplierProductId,
          item,
        });
      }
      billLines.push({
        description: line.description,
        qty: line.qtyRaw,
        unitCost: line.unitCostRaw,
        amount: roundMoney(line.qtyRaw * line.unitCostRaw),
        mapping: { type: "item" as const, itemId: item.id, itemName: item.name },
      });
    } else {
      const account =
        (choice?.qboId ? accountById.get(choice.qboId) : null) ?? defaultAccount;
      billLines.push({
        description: line.description,
        qty: line.qtyRaw,
        unitCost: line.unitCostRaw,
        amount: roundMoney(line.qtyRaw * line.unitCostRaw),
        mapping: {
          type: "account" as const,
          accountId: account.id,
          accountName: account.name,
        },
      });
    }
  }

  const extras = [];
  if (Math.abs(po.taxAmountRaw) >= 0.005) {
    extras.push({
      description: "Tax",
      amount: roundMoney(po.taxAmountRaw),
      accountId: defaultAccount.id,
      accountName: defaultAccount.name,
    });
  }
  if (Math.abs(po.shippingAmountRaw) >= 0.005) {
    extras.push({
      description: "Shipping",
      amount: roundMoney(po.shippingAmountRaw),
      accountId: defaultAccount.id,
      accountName: defaultAccount.name,
    });
  }
  if (Math.abs(po.adjustmentAmountRaw) >= 0.005) {
    extras.push({
      description: "Adjustment",
      amount: roundMoney(po.adjustmentAmountRaw),
      accountId: defaultAccount.id,
      accountName: defaultAccount.name,
    });
  }

  const lineTotal = roundMoney(
    billLines.reduce((sum, line) => sum + line.amount, 0) +
      extras.reduce((sum, extra) => sum + extra.amount, 0),
  );
  const invoiceAmount = po.invoiceAmountRaw ?? po.threeWayMatch.poTotal;
  const variance = varianceExtra({
    invoiceAmount,
    lineTotal,
    accountId: defaultAccount.id,
    accountName: defaultAccount.name,
  });
  if (variance) extras.push(variance);

  const payload = buildBillPayload({
    vendorId: vendor.id,
    docNumber: po.poNumber,
    txnDate: todayIsoDate(),
    privateNote: `Requisly ${po.poNumber}`,
    lines: billLines,
    extras,
  });

  let created;
  try {
    created = await createQboBill(opts.workspaceId, payload.bill);
  } catch (err) {
    const message =
      err instanceof QboReconnectNeededError || err instanceof QboApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "QuickBooks push failed.";
    await recordPushFailure(opts.workspaceId, po.id, po.status, message);
    throw err instanceof Error ? err : new Error(message);
  }

  const billUrl = billDeepLink(created.id);
  const now = new Date().toISOString();
  const supabase = createServiceClient();
  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      qb_pushed_at: now,
      qb_bill_id: created.id,
      qb_last_error: null,
      updated_at: now,
    })
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId);
  if (updateError) throw new Error(updateError.message);

  const { error: eventError } = await supabase.from("po_timeline_events").insert({
    po_id: po.id,
    event_type: po.status,
    actor: "merchant",
    metadata: {
      kind: "qb_push",
      summary: opts.force
        ? `Pushed again to QuickBooks Bill ${created.id}. ${po.threeWayMatch.summary}`
        : opts.acknowledgeDiscrepancy
          ? `Pushed to QuickBooks Bill ${created.id} with acknowledged discrepancy. ${po.threeWayMatch.summary}`
          : `Pushed to QuickBooks Bill ${created.id}. ${po.threeWayMatch.summary}`,
      acknowledged: opts.acknowledgeDiscrepancy,
      force: opts.force,
      match: po.threeWayMatch.summary,
      qb_bill_id: created.id,
      qb_doc_number: created.docNumber,
      total: payload.previewTotal,
    },
  });
  if (eventError) throw new Error(eventError.message);

  return {
    pushed: true,
    alreadySynced: false,
    summary: `Pushed ${po.poNumber} as QuickBooks Bill ${created.docNumber ?? created.id} (${money(payload.previewTotal)}).`,
    billId: created.id,
    billUrl,
  };
}

async function recordPushFailure(
  workspaceId: string,
  poId: string,
  status: string,
  message: string,
) {
  const supabase = createServiceClient();
  await supabase
    .from("purchase_orders")
    .update({
      qb_last_error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", poId)
    .eq("workspace_id", workspaceId);
  await supabase.from("po_timeline_events").insert({
    po_id: poId,
    event_type: status,
    actor: "merchant",
    metadata: {
      kind: "qb_push_failed",
      summary: `QuickBooks push failed: ${message}`,
    },
  });
}
