import { authenticate } from "../shopify.server";
import db, { getCustomerData, redactCustomerData, redactShopData } from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case 'APP_UNINSTALLED':
      if (session) {
        await db.session.deleteMany({where: {shop}});
      }
      break;

    case 'CUSTOMERS_DATA_REQUEST': {
      // Return stored data for the customer
      const customerEmail = payload?.customer?.email;
      if (customerEmail) {
        const data = await getCustomerData(shop, customerEmail);
        console.log(`Customer data request for ${customerEmail} at ${shop}:`, {
          conversations: data.conversations.length,
          tokens: data.tokens.length,
          activity: data.activity.length,
        });
      }
      break;
    }

    case 'CUSTOMERS_REDACT': {
      // Delete all data for the customer
      const customerEmail = payload?.customer?.email;
      if (customerEmail) {
        await redactCustomerData(shop, customerEmail);
        console.log(`Redacted customer data for ${customerEmail} at ${shop}`);
      }
      break;
    }

    case 'SHOP_REDACT': {
      // Delete ALL data for the uninstalled shop
      await redactShopData(shop);
      console.log(`Redacted all shop data for ${shop}`);
      break;
    }

    default:
      throw new Response('Unhandled webhook topic', {status: 404});
  }

  return new Response();
};
