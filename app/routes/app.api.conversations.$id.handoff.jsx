import { authenticate } from "../shopify.server";
import { getConversation, takeOverConversation, releaseConversation, saveMessage } from "../db.server";

/**
 * POST: Handle conversation handoff actions (take_over / release)
 */
export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const conversationId = params.id;

  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.shop !== session.shop) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  const body = await request.json();
  const actionType = body.action;

  if (actionType === 'take_over') {
    const merchantId = session.id || session.shop;
    const result = await takeOverConversation(conversationId, merchantId);

    if (result.error) {
      if (result.error === 'already_taken') {
        return new Response(JSON.stringify({
          error: "This conversation has already been taken over by another team member.",
        }), { status: 409 });
      }
      console.error('Takeover failed:', result.error, result.message || '');
      return new Response(JSON.stringify({
        error: "Failed to take over conversation. Please try again.",
      }), { status: 500 });
    }

    // Insert system message so the customer knows
    await saveMessage(conversationId, 'assistant', 'A team member has joined the chat.');

    return { success: true, mode: 'merchant', conversation: result.conversation };
  }

  if (actionType === 'release') {
    const result = await releaseConversation(conversationId);
    if (!result) {
      return new Response(JSON.stringify({ error: "Failed to release conversation" }), { status: 500 });
    }

    // Insert system message
    await saveMessage(conversationId, 'assistant', "You're now chatting with our AI assistant again.");

    return { success: true, mode: 'ai', conversation: result };
  }

  return new Response(JSON.stringify({ error: "Invalid action. Use 'take_over' or 'release'." }), { status: 400 });
};
