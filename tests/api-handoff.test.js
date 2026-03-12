/**
 * Tests for the handoff API route: app/routes/app.api.conversations.$id.handoff.jsx
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
  createTestConversation,
  createTestMessage,
  cleanupConversations,
  disconnectPrisma,
  mockRequest,
  getPrisma,
} from './test-helper.js';

// Mock authenticate.admin before importing the route
vi.mock('../app/shopify.server', () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: 'test-shop.myshopify.com', id: 'staff_1' },
    })),
  },
}));

// Import the action after mocking
const { action } = await import('../app/routes/app.api.conversations.$id.handoff.jsx');

describe('Handoff API Route', () => {
  const createdIds = [];

  afterEach(async () => {
    await cleanupConversations(createdIds.splice(0));
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('take_over succeeds and returns merchant mode', async () => {
    const conv = await createTestConversation();
    createdIds.push(conv.id);

    const request = mockRequest({
      method: 'POST',
      body: { action: 'take_over' },
    });
    const result = await action({ request, params: { id: conv.id } });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('merchant');
    expect(result.conversation.assignedTo).toBe('staff_1');
  });

  it('take_over inserts system message', async () => {
    const conv = await createTestConversation();
    createdIds.push(conv.id);

    const request = mockRequest({
      method: 'POST',
      body: { action: 'take_over' },
    });
    await action({ request, params: { id: conv.id } });

    const db = getPrisma();
    const messages = await db.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toContain('team member has joined');
  });

  it('take_over with optimistic lock conflict returns 409', async () => {
    const conv = await createTestConversation({
      mode: 'merchant',
      assignedTo: 'other_staff',
    });
    createdIds.push(conv.id);

    const request = mockRequest({
      method: 'POST',
      body: { action: 'take_over' },
    });
    const result = await action({ request, params: { id: conv.id } });

    // Should be a Response with 409
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(409);
    const body = await result.json();
    expect(body.error).toContain('already been taken over');
  });

  it('release succeeds and returns ai mode', async () => {
    const conv = await createTestConversation({
      mode: 'merchant',
      assignedTo: 'staff_1',
      handoffAt: new Date(),
    });
    createdIds.push(conv.id);

    const request = mockRequest({
      method: 'POST',
      body: { action: 'release' },
    });
    const result = await action({ request, params: { id: conv.id } });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('ai');
  });

  it('release inserts system message', async () => {
    const conv = await createTestConversation({
      mode: 'merchant',
      assignedTo: 'staff_1',
      handoffAt: new Date(),
    });
    createdIds.push(conv.id);

    const request = mockRequest({
      method: 'POST',
      body: { action: 'release' },
    });
    await action({ request, params: { id: conv.id } });

    const db = getPrisma();
    const messages = await db.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toContain('AI assistant');
  });

  it('returns 404 for wrong shop', async () => {
    const conv = await createTestConversation({ shop: 'other-shop.myshopify.com' });
    createdIds.push(conv.id);

    const request = mockRequest({
      method: 'POST',
      body: { action: 'take_over' },
    });
    const result = await action({ request, params: { id: conv.id } });

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(404);
  });

  it('returns 400 for invalid action', async () => {
    const conv = await createTestConversation();
    createdIds.push(conv.id);

    const request = mockRequest({
      method: 'POST',
      body: { action: 'invalid_action' },
    });
    const result = await action({ request, params: { id: conv.id } });

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error).toContain("Invalid action");
  });
});
