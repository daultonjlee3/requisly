import { SupplierLinkClient } from "@/components/SupplierLinkClient";

export default async function SupplierLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SupplierLinkClient token={token} />;
}
