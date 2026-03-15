import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getActiveConversations } from "../db.server";

/**
 * GET: Return active conversations for the shop (last 24h)
 * Includes lastActivityAt for online/offline status
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const conversations = await getActiveConversations(session.shop);

  // Fetch activity timestamps for all conversations in one query
  const convIds = conversations.map(c => c.id);
  const activities = convIds.length > 0 ? await prisma.customerActivity.findMany({
    where: { conversationId: { in: convIds } },
    select: { conversationId: true, updatedAt: true },
  }) : [];
  const activityMap = Object.fromEntries(activities.map(a => [a.conversationId, a.updatedAt]));

  // Merge lastActivityAt into each conversation
  const enriched = conversations.map(c => ({
    ...c,
    lastActivityAt: activityMap[c.id] || null,
  }));

  return { conversations: enriched };
};
