import { createServiceClient } from "./supabase.server";
import { relativeTime, shortDate } from "./format";
import {
  contractRenewalLabel,
  DEFAULT_CONTRACT_LEAD_DAYS,
  isDateOnly,
} from "./contract-renewal";
import { utcToday } from "./recurring-po";
import {
  resolveListWindow,
  sanitizeSearch,
  type ListPageOpts,
  type ListPageResult,
} from "./list-table";

const BUCKET = "supplier-contracts";
const MAX_BYTES = 50 * 1024 * 1024;

export type SupplierContractRow = {
  id: string;
  title: string;
  startDate: string | null;
  startLabel: string;
  renewalDate: string | null;
  renewalLabel: string;
  renewalStatusLabel: string;
  renewalTone: "info" | "warning" | "critical" | "success" | undefined;
  notes: string | null;
  fileName: string | null;
  fileType: string | null;
  downloadUrl: string | null;
  createdLabel: string;
};

export type WorkspaceContractRow = SupplierContractRow & {
  supplierId: string;
  supplierName: string;
};

function emptyToNull(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

function dateOrNull(value: unknown): string | null {
  const s = emptyToNull(value);
  return s && isDateOnly(s) ? s : null;
}

async function signedUrl(filePath: string | null): Promise<string | null> {
  if (!filePath) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

function mapRow(
  row: {
    id: string;
    title: string;
    start_date: string | null;
    renewal_date: string | null;
    notes: string | null;
    file_path: string | null;
    file_name: string | null;
    file_type: string | null;
    created_at: string;
  },
  downloadUrl: string | null,
  today: string,
): SupplierContractRow {
  const status = contractRenewalLabel({
    renewalDate: row.renewal_date,
    today,
    leadDays: DEFAULT_CONTRACT_LEAD_DAYS,
  });
  return {
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    startLabel: shortDate(row.start_date),
    renewalDate: row.renewal_date,
    renewalLabel: shortDate(row.renewal_date),
    renewalStatusLabel: status.label,
    renewalTone: status.tone,
    notes: row.notes,
    fileName: row.file_name,
    fileType: row.file_type,
    downloadUrl,
    createdLabel: relativeTime(row.created_at),
  };
}

export async function listSupplierContracts(
  workspaceId: string,
  supplierId: string,
): Promise<SupplierContractRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("supplier_contracts")
    .select(
      "id, title, start_date, renewal_date, notes, file_path, file_name, file_type, created_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("supplier_id", supplierId)
    .order("renewal_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const today = utcToday();
  const rows: SupplierContractRow[] = [];
  for (const row of data ?? []) {
    rows.push(mapRow(row, await signedUrl(row.file_path), today));
  }
  return rows;
}

export async function listWorkspaceContracts(
  workspaceId: string,
  opts?: ListPageOpts,
): Promise<ListPageResult<WorkspaceContractRow>> {
  const supabase = createServiceClient();
  const q = sanitizeSearch(opts?.q);
  const window = resolveListWindow(opts);
  let query = supabase
    .from("supplier_contracts")
    .select(
      "id, supplier_id, title, start_date, renewal_date, notes, file_path, file_name, file_type, created_at, suppliers(name)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("renewal_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(window.from, window.to);
  if (q) {
    query = query.or(`title.ilike.%${q}%,notes.ilike.%${q}%`);
  }
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const today = utcToday();
  const rows: WorkspaceContractRow[] = [];
  for (const row of data ?? []) {
    const supplier = row.suppliers as unknown as { name: string } | null;
    rows.push({
      ...mapRow(row, await signedUrl(row.file_path), today),
      supplierId: row.supplier_id,
      supplierName: supplier?.name ?? "—",
    });
  }
  return { rows, total: count ?? 0 };
}

async function uploadContractFile(opts: {
  workspaceId: string;
  supplierId: string;
  contractId: string;
  fileName: string;
  fileType: string;
  bytes: Buffer;
}): Promise<{ path: string; fileName: string; fileType: string }> {
  if (opts.bytes.length > MAX_BYTES) {
    throw new Error("File is too large (50 MB max)");
  }
  const safeName = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${opts.workspaceId}/${opts.supplierId}/${opts.contractId}/${Date.now()}-${safeName}`;
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, opts.bytes, {
    contentType: opts.fileType || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return {
    path,
    fileName: opts.fileName,
    fileType: opts.fileType || "application/octet-stream",
  };
}

async function removeStoragePath(filePath: string | null) {
  if (!filePath) return;
  const supabase = createServiceClient();
  await supabase.storage.from(BUCKET).remove([filePath]);
}

export async function createSupplierContract(opts: {
  workspaceId: string;
  supplierId: string;
  title: string;
  startDate?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
  file?: { name: string; type: string; bytes: Buffer } | null;
}): Promise<{ id: string }> {
  const title = opts.title.trim();
  if (!title) throw new Error("Contract title is required");

  const supabase = createServiceClient();
  const { data: supplier, error: sErr } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", opts.supplierId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!supplier) throw new Error("Supplier not found");

  const { data, error } = await supabase
    .from("supplier_contracts")
    .insert({
      workspace_id: opts.workspaceId,
      supplier_id: opts.supplierId,
      title,
      start_date: dateOrNull(opts.startDate),
      renewal_date: dateOrNull(opts.renewalDate),
      notes: emptyToNull(opts.notes),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (opts.file && opts.file.bytes.length > 0) {
    const stored = await uploadContractFile({
      workspaceId: opts.workspaceId,
      supplierId: opts.supplierId,
      contractId: data.id,
      fileName: opts.file.name,
      fileType: opts.file.type,
      bytes: opts.file.bytes,
    });
    const { error: upErr } = await supabase
      .from("supplier_contracts")
      .update({
        file_path: stored.path,
        file_name: stored.fileName,
        file_type: stored.fileType,
      })
      .eq("id", data.id)
      .eq("workspace_id", opts.workspaceId);
    if (upErr) throw new Error(upErr.message);
  }

  return { id: data.id };
}

export async function updateSupplierContract(opts: {
  workspaceId: string;
  supplierId: string;
  contractId: string;
  title: string;
  startDate?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
  file?: { name: string; type: string; bytes: Buffer } | null;
}): Promise<void> {
  const title = opts.title.trim();
  if (!title) throw new Error("Contract title is required");

  const supabase = createServiceClient();
  const { data: existing, error } = await supabase
    .from("supplier_contracts")
    .select("id, file_path")
    .eq("id", opts.contractId)
    .eq("workspace_id", opts.workspaceId)
    .eq("supplier_id", opts.supplierId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) throw new Error("Contract not found");

  let filePatch: Record<string, string> = {};
  if (opts.file && opts.file.bytes.length > 0) {
    const stored = await uploadContractFile({
      workspaceId: opts.workspaceId,
      supplierId: opts.supplierId,
      contractId: opts.contractId,
      fileName: opts.file.name,
      fileType: opts.file.type,
      bytes: opts.file.bytes,
    });
    await removeStoragePath(existing.file_path);
    filePatch = {
      file_path: stored.path,
      file_name: stored.fileName,
      file_type: stored.fileType,
    };
  }

  const { error: upErr } = await supabase
    .from("supplier_contracts")
    .update({
      title,
      start_date: dateOrNull(opts.startDate),
      renewal_date: dateOrNull(opts.renewalDate),
      notes: emptyToNull(opts.notes),
      ...filePatch,
    })
    .eq("id", opts.contractId)
    .eq("workspace_id", opts.workspaceId)
    .eq("supplier_id", opts.supplierId);
  if (upErr) throw new Error(upErr.message);
}

export async function deleteSupplierContract(opts: {
  workspaceId: string;
  supplierId: string;
  contractId: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("supplier_contracts")
    .select("id, file_path")
    .eq("id", opts.contractId)
    .eq("workspace_id", opts.workspaceId)
    .eq("supplier_id", opts.supplierId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Contract not found");

  await removeStoragePath(data.file_path);
  const { error: delErr } = await supabase
    .from("supplier_contracts")
    .delete()
    .eq("id", opts.contractId)
    .eq("workspace_id", opts.workspaceId)
    .eq("supplier_id", opts.supplierId);
  if (delErr) throw new Error(delErr.message);
}
