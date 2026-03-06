import { authenticate } from "../shopify.server";
import { getConversation, getConversationHistory, getMessagesSince, saveMessage, updateConversation } from "../db.server";

/**
 * GET: Return messages for a conversation. Supports ?since= for incremental polling.
 * Also checks inactivity timeout — auto-releases to AI after 5 min of merchant silence.
 */
export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const conversationId = params.id;

  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.shop !== session.shop) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  // Check inactivity timeout: if merchant mode and no merchant message in 5 min, auto-release
  if (conversation.mode === 'merchant' && conversation.handoffAt) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentMerchantMessages = await getMessagesSince(conversationId, fiveMinAgo.toISOString());
    const hasMerchantActivity = recentMerchantMessages.some(m => m.role === 'merchant');

    if (!hasMerchantActivity && new Date(conversation.handoffAt) < fiveMinAgo) {
      await updateConversation(conversationId, {
        mode: 'ai',
        assignedTo: null,
        handoffAt: null,
      });
      await saveMessage(conversationId, 'assistant', 'Our team member stepped away. The AI assistant is back to help you.');
      // Refresh conversation after update
      const updated = await getConversation(conversationId);
      const messages = await getConversationHistory(conversationId);
      return { messages, mode: updated?.mode || 'ai', autoReleased: true };
    }
  }

  const url = new URL(request.url);
  const since = url.searchParams.get('since');

  const messages = since
    ? await getMessagesSince(conversationId, since)
    : await getConversationHistory(conversationId);

  return { messages, mode: conversation.mode };
};

/**
 * POST: Merchant sends a message. Saves with role "merchant".
 */
export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const conversationId = params.id;

  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.shop !== session.shop) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  if (conversation.mode !== 'merchant') {
    return new Response(JSON.stringify({ error: "Conversation is not in merchant mode" }), { status: 400 });
  }

  const body = await request.json();
  const content = (body.content || '').trim();

  if (!content) {
    return new Response(JSON.stringify({ error: "Message content required" }), { status: 400 });
  }

  // Plain text only — strip any HTML
  const sanitized = content.replace(/<[^>]*>/g, '');

  const message = await saveMessage(conversationId, 'merchant', sanitized);

  return { message };
};
