import { authenticate } from "../shopify.server";
import { getConversation, getCustomerActivity } from "../db.server";

/**
 * GET: Return customer activity for a conversation (current page, cart, viewed product).
 */
export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const conversationId = params.id;

  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.shop !== session.shop) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  const activity = await getCustomerActivity(conversationId);
  return { activity: activity || null };
};
