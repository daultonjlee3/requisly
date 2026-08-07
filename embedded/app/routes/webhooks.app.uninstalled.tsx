import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../lib/compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Same hard cleanup as shop/redact (idempotent if shop/redact arrives later).
  await purgeShopData(shop, "app/uninstalled", payload);

  return new Response();
};
