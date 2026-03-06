/**
 * Tests for the live chats list API: app/routes/app.api.live-chats.jsx
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import {
  createTestConversation,
  createTestMessage,
  cleanupConversations,
  disconnectPrisma,
  mockRequest,
} from './test-helper.js';

// Mock authenticate.admin
vi.mock('../app/shopify.server', () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: 'test-shop.myshopify.com', id: 'staff_1' },
    })),
  },
}));

const { loader } = await import('../app/routes/app.api.live-chats.jsx');

describe('Live Chats API Route', () => {
  const createdIds = [];

  afterEach(async () => {
    await cleanupConversations(createdIds.splice(0));
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('returns active conversations with message count and preview', async () => {
    const conv = await createTestConversation();
    createdIds.push(conv.id);
    await createTestMessage(conv.id, 'user', 'I need help');
    await createTestMessage(conv.id, 'assistant', 'How can I help?');

    const request = mockRequest();
    const result = await loader({ request });

    expect(result.conversations).toBeInstanceOf(Array);
    // Find our test conversation
    const found = result.conversations.find(c => c.id === conv.id);
    expect(found).toBeTruthy();
    expect(found._count.messages).toBe(2);
    expect(found.messages.length).toBe(1); // Only the last message preview
  });

  it('returns empty for shop with no conversations', async () => {
    // Override mock to return a different shop
    const { authenticate } = await import('../app/shopify.server');
    authenticate.admin.mockResolvedValueOnce({
      session: { shop: `empty-shop-${Date.now()}.myshopify.com`, id: 'staff_1' },
    });

    const request = mockRequest();
    const result = await loader({ request });

    expect(result.conversations).toEqual([]);
  });
});
