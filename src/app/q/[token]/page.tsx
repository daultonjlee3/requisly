import { QuoteRequestLinkClient } from "@/components/QuoteRequestLinkClient";

export default async function QuoteRequestLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <QuoteRequestLinkClient token={token} />;
}
