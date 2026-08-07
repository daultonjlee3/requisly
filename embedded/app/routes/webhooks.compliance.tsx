import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  handleCustomersDataRequest,
  handleCustomersRedact,
  purgeShopData,
} from "../lib/compliance.server";

/**
 * Mandatory App Store compliance webhooks.
 * Registered in shopify.app.toml → compliance_topics → /webhooks/compliance
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[compliance] ${topic} for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      await handleCustomersDataRequest(shop, payload as never);
      break;
    case "CUSTOMERS_REDACT":
      await handleCustomersRedact(shop, payload as never);
      break;
    case "SHOP_REDACT":
      await purgeShopData(shop, "shop/redact", payload);
      break;
    default:
      console.warn(`[compliance] unhandled topic ${topic}`);
      return new Response("Unhandled topic", { status: 404 });
  }

  return new Response();
};
