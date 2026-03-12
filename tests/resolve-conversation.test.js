import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { getPrisma, createTestConversation, cleanupConversations, disconnectPrisma, uniqueId } from './test-helper';

const db = getPrisma();
const testIds = [];

afterEach(async () => {
  if (testIds.length) {
    await cleanupConversations(testIds);
    testIds.length = 0;
  }
});

afterAll(async () => {
  await disconnectPrisma();
});

describe('resolveConversation', () => {
  // Import dynamically to avoid module-level side effects
  let resolveConversation;

  it('setup: import resolveConversation', async () => {
    const mod = await import('~/db.server');
    resolveConversation = mod.resolveConversation;
    expect(resolveConversation).toBeTypeOf('function');
  });

  it('sets resolvedAt, resets mode to ai, clears assignedTo and handoffAt', async () => {
    const { resolveConversation: resolve } = await import('~/db.server');
    const id = uniqueId('resolve');
    testIds.push(id);
    await createTestConversation({ id, mode: 'merchant', assignedTo: 'staff_1', handoffAt: new Date() });

    const result = await resolve(id);
    expect(result).not.toBeNull();
    expect(result.resolvedAt).toBeInstanceOf(Date);
    expect(result.mode).toBe('ai');
    expect(result.assignedTo).toBeNull();
    expect(result.handoffAt).toBeNull();
  });

  it('returns null for non-existent conversation', async () => {
    const { resolveConversation: resolve } = await import('~/db.server');
    const result = await resolve('nonexistent_conv_id');
    expect(result).toBeNull();
  });
});
