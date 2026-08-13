import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../lib/compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Soft revoke (credentials + sessions); workspace kept for reinstall reclaim.
  // TODO(prod): After first production deploy, confirm Shopify actually delivers
  // app/uninstalled end-to-end (compliance_events row with action=revoked, creds
  // cleared, Prisma sessions gone). Local Cloudflare tunnels did not receive this
  // webhook during isolation QA — soft-uninstall was verified only by invoking
  // purgeShopData directly. Do not treat local tunnel silence as proof of prod delivery.
  await purgeShopData(shop, "app/uninstalled", payload);

  return new Response();
};
