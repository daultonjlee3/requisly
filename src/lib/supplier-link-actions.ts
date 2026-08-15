"use server";

import { runSupplierLinkRpc } from "@/lib/supplier-link.server";

export async function runSupplierLinkAction(
  name: string,
  args: Record<string, unknown>,
) {
  return runSupplierLinkRpc(name, args);
}
