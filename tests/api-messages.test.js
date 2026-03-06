/**
 * Tests for the messages API route: app/routes/app.api.conversations.$id.messages.jsx
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import {
  createTestConversation,
  createTestMessage,
  cleanupConversations,
  disconnectPrisma,
  mockRequest,
  getPrisma,
} from './test-helper.js';

// Mock authenticate.admin
vi.mock('../app/shopify.server', () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: 'test-shop.myshopify.com', id: 'staff_1' },
    })),
  },
}));

const { loader, action } = await import('../app/routes/app.api.conversations.$id.messages.jsx');

describe('Messages API Route', () => {
  const createdIds = [];

  afterEach(async () => {
    await cleanupConversations(createdIds.splice(0));
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  // ── GET (loader) ───────────────────────────────────────────────────

  describe('GET messages', () => {
    it('returns all messages', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);
      await createTestMessage(conv.id, 'user', 'Hello');
      await createTestMessage(conv.id, 'assistant', 'Hi there');

      const request = mockRequest({
        url: `http://localhost/api/conversations/${conv.id}/messages`,
      });
      const result = await loader({ request, params: { id: conv.id } });

      expect(result.messages.length).toBe(2);
      expect(result.mode).toBe('ai');
    });

    it('returns only messages since timestamp', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);
      await createTestMessage(conv.id, 'user', 'old');
      await new Promise(r => setTimeout(r, 50));
      const cutoff = new Date().toISOString();
      await new Promise(r => setTimeout(r, 50));
      await createTestMessage(conv.id, 'assistant', 'new');

      const request = mockRequest({
        url: `http://localhost/api/conversations/${conv.id}/messages?since=${encodeURIComponent(cutoff)}`,
      });
      const result = await loader({ request, params: { id: conv.id } });

      expect(result.messages.length).toBe(1);
      expect(result.messages[0].content).toBe('new');
    });

    it('auto-releases to AI after inactivity timeout', async () => {
      const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000);
      const conv = await createTestConversation({
        mode: 'merchant',
        assignedTo: 'staff_1',
        handoffAt: sixMinAgo,
      });
      createdIds.push(conv.id);
      // No merchant messages in recent 5 minutes

      const request = mockRequest({
        url: `http://localhost/api/conversations/${conv.id}/messages`,
      });
      const result = await loader({ request, params: { id: conv.id } });

      expect(result.mode).toBe('ai');
      expect(result.autoReleased).toBe(true);

      // Verify system message was inserted
      const hasSystemMsg = result.messages.some(
        m => m.role === 'assistant' && m.content.includes('stepped away')
      );
      expect(hasSystemMsg).toBe(true);
    });

    it('returns 404 for wrong shop', async () => {
      const conv = await createTestConversation({ shop: 'other-shop.myshopify.com' });
      createdIds.push(conv.id);

      const request = mockRequest({
        url: `http://localhost/api/conversations/${conv.id}/messages`,
      });
      const result = await loader({ request, params: { id: conv.id } });

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(404);
    });
  });

  // ── POST (action) ──────────────────────────────────────────────────

  describe('POST messages', () => {
    it('saves merchant message with role "merchant"', async () => {
      const conv = await createTestConversation({
        mode: 'merchant',
        assignedTo: 'staff_1',
      });
      createdIds.push(conv.id);

      const request = mockRequest({
        method: 'POST',
        body: { content: 'Hello from merchant' },
      });
      const result = await action({ request, params: { id: conv.id } });

      expect(result.message).toBeTruthy();
      expect(result.message.role).toBe('merchant');
      expect(result.message.content).toBe('Hello from merchant');
    });

    it('rejects when not in merchant mode', async () => {
      const conv = await createTestConversation({ mode: 'ai' });
      createdIds.push(conv.id);

      const request = mockRequest({
        method: 'POST',
        body: { content: 'test' },
      });
      const result = await action({ request, params: { id: conv.id } });

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(400);
      const body = await result.json();
      expect(body.error).toContain('not in merchant mode');
    });

    it('rejects empty content', async () => {
      const conv = await createTestConversation({
        mode: 'merchant',
        assignedTo: 'staff_1',
      });
      createdIds.push(conv.id);

      const request = mockRequest({
        method: 'POST',
        body: { content: '   ' },
      });
      const result = await action({ request, params: { id: conv.id } });

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(400);
      const body = await result.json();
      expect(body.error).toContain('content required');
    });

    it('strips HTML tags from content', async () => {
      const conv = await createTestConversation({
        mode: 'merchant',
        assignedTo: 'staff_1',
      });
      createdIds.push(conv.id);

      const request = mockRequest({
        method: 'POST',
        body: { content: '<script>alert("xss")</script>Hello <b>world</b>' },
      });
      const result = await action({ request, params: { id: conv.id } });

      expect(result.message.content).toBe('alert("xss")Hello world');
    });
  });
});
