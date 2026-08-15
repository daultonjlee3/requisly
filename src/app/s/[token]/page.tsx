import { SupplierLinkClient } from "@/components/SupplierLinkClient";
import { openSupplierLink } from "@/lib/supplier-link.server";

export const dynamic = "force-dynamic";

export default async function SupplierLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await openSupplierLink(token);
  return (
    <SupplierLinkClient
      token={token}
      initialData={result.data}
      initialError={result.error}
    />
  );
}
