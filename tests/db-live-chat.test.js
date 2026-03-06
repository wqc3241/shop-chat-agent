/**
 * Tests for the 6 live-chat DB functions in app/db.server.js
 * Uses a real SQLite database via Prisma.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import {
  getConversation,
  getMessagesSince,
  updateConversation,
  getActiveConversations,
  takeOverConversation,
  releaseConversation,
  saveMessage,
} from '../app/db.server.js';
import {
  getPrisma,
  uniqueId,
  createTestConversation,
  createTestMessage,
  cleanupConversations,
  disconnectPrisma,
} from './test-helper.js';

describe('DB Live Chat Functions', () => {
  const createdIds = [];

  afterEach(async () => {
    await cleanupConversations(createdIds.splice(0));
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  // ── getConversation ────────────────────────────────────────────────

  describe('getConversation', () => {
    it('returns conversation when found', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      const result = await getConversation(conv.id);
      expect(result).not.toBeNull();
      expect(result.id).toBe(conv.id);
      expect(result.mode).toBe('ai');
    });

    it('returns null when not found', async () => {
      const result = await getConversation('nonexistent_' + Date.now());
      expect(result).toBeNull();
    });
  });

  // ── getMessagesSince ───────────────────────────────────────────────

  describe('getMessagesSince', () => {
    it('returns messages after the given timestamp', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      // Create messages with staggered times
      const msg1 = await createTestMessage(conv.id, 'user', 'old message');
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 50));
      const cutoff = new Date();
      await new Promise(r => setTimeout(r, 50));
      const msg2 = await createTestMessage(conv.id, 'assistant', 'new message');

      const results = await getMessagesSince(conv.id, cutoff.toISOString());
      expect(results.length).toBe(1);
      expect(results[0].content).toBe('new message');
    });

    it('returns empty array when no messages after timestamp', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      await createTestMessage(conv.id, 'user', 'hello');
      await new Promise(r => setTimeout(r, 50));

      const future = new Date(Date.now() + 60000);
      const results = await getMessagesSince(conv.id, future.toISOString());
      expect(results).toEqual([]);
    });

    it('returns messages in chronological order', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      const cutoff = new Date();
      await new Promise(r => setTimeout(r, 50));
      await createTestMessage(conv.id, 'user', 'first');
      await new Promise(r => setTimeout(r, 50));
      await createTestMessage(conv.id, 'assistant', 'second');

      const results = await getMessagesSince(conv.id, cutoff.toISOString());
      expect(results.length).toBe(2);
      expect(results[0].content).toBe('first');
      expect(results[1].content).toBe('second');
    });
  });

  // ── updateConversation ─────────────────────────────────────────────

  describe('updateConversation', () => {
    it('updates fields on existing conversation', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      const result = await updateConversation(conv.id, {
        mode: 'merchant',
        assignedTo: 'staff_1',
      });

      expect(result).not.toBeNull();
      expect(result.mode).toBe('merchant');
      expect(result.assignedTo).toBe('staff_1');
    });

    it('returns null for non-existent conversation', async () => {
      const result = await updateConversation('nonexistent_' + Date.now(), {
        mode: 'merchant',
      });
      expect(result).toBeNull();
    });
  });

  // ── getActiveConversations ─────────────────────────────────────────

  describe('getActiveConversations', () => {
    it('returns conversations updated in the last 24h with previews', async () => {
      const shop = `test-active-${Date.now()}.myshopify.com`;
      const conv = await createTestConversation({ shop });
      createdIds.push(conv.id);
      await createTestMessage(conv.id, 'user', 'Hello there');

      const results = await getActiveConversations(shop);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(conv.id);
      expect(results[0]._count.messages).toBe(1);
      expect(results[0].messages[0].content).toBe('Hello there');
    });

    it('returns empty for unknown shop', async () => {
      const results = await getActiveConversations('unknown-shop-' + Date.now() + '.myshopify.com');
      expect(results).toEqual([]);
    });

    it('excludes conversations older than 24h', async () => {
      const db = getPrisma();
      const shop = `test-old-${Date.now()}.myshopify.com`;
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const conv = await db.conversation.create({
        data: {
          id: uniqueId('old'),
          shop,
          mode: 'ai',
          updatedAt: oldDate,
        },
      });
      createdIds.push(conv.id);

      const results = await getActiveConversations(shop);
      expect(results.length).toBe(0);
    });
  });

  // ── takeOverConversation ───────────────────────────────────────────

  describe('takeOverConversation', () => {
    it('succeeds when no one has taken it', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      const result = await takeOverConversation(conv.id, 'staff_1');
      expect(result.conversation).toBeTruthy();
      expect(result.conversation.mode).toBe('merchant');
      expect(result.conversation.assignedTo).toBe('staff_1');
      expect(result.conversation.handoffAt).toBeTruthy();
    });

    it('blocks second takeover (optimistic lock)', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      // First takeover succeeds
      const first = await takeOverConversation(conv.id, 'staff_1');
      expect(first.conversation).toBeTruthy();

      // Second takeover fails — already assigned
      const second = await takeOverConversation(conv.id, 'staff_2');
      expect(second.error).toBe('already_taken');
      expect(second.assignedTo).toBe('staff_1');

      // Verify the first staff member is still assigned
      const check = await getConversation(conv.id);
      expect(check.assignedTo).toBe('staff_1');
    });
  });

  // ── releaseConversation ────────────────────────────────────────────

  describe('releaseConversation', () => {
    it('resets mode, assignedTo, and handoffAt', async () => {
      const conv = await createTestConversation({
        mode: 'merchant',
        assignedTo: 'staff_1',
        handoffAt: new Date(),
      });
      createdIds.push(conv.id);

      const result = await releaseConversation(conv.id);
      expect(result).not.toBeNull();
      expect(result.mode).toBe('ai');
      expect(result.assignedTo).toBeNull();
      expect(result.handoffAt).toBeNull();
    });

    it('returns null for non-existent conversation', async () => {
      const result = await releaseConversation('nonexistent_' + Date.now());
      expect(result).toBeNull();
    });
  });
});
