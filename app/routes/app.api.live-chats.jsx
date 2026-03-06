import { authenticate } from "../shopify.server";
import { getActiveConversations } from "../db.server";

/**
 * GET: Return active conversations for the shop (last 24h)
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const conversations = await getActiveConversations(session.shop);

  return { conversations };
};
