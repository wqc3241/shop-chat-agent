/**
 * Test helper — provides a fresh Prisma client and utilities for test suites.
 * Uses the same SQLite DB as dev (prisma/dev.sqlite) but cleans up after each test.
 */
import { PrismaClient } from '@prisma/client';

let prisma;

/**
 * Get a shared Prisma client for tests
 */
export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

/**
 * Generate a unique ID with a prefix to avoid collisions between tests
 */
export function uniqueId(prefix = 'test') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a test conversation with optional overrides
 */
export async function createTestConversation(overrides = {}) {
  const db = getPrisma();
  const id = overrides.id || uniqueId('conv');
  return db.conversation.create({
    data: {
      id,
      shop: 'test-shop.myshopify.com',
      mode: 'ai',
      ...overrides,
    },
  });
}

/**
 * Create a test message
 */
export async function createTestMessage(conversationId, role, content, overrides = {}) {
  const db = getPrisma();
  return db.message.create({
    data: {
      conversationId,
      role,
      content,
      ...overrides,
    },
  });
}

/**
 * Clean up test data by IDs
 */
export async function cleanupConversations(ids) {
  const db = getPrisma();
  if (ids.length === 0) return;
  // Messages cascade on conversation delete
  await db.conversation.deleteMany({
    where: { id: { in: ids } },
  });
}

/**
 * Disconnect Prisma after all tests
 */
export async function disconnectPrisma() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Build a mock Request object for route handler tests
 */
export function mockRequest({ method = 'GET', url = 'http://localhost/test', body = null, headers = {} } = {}) {
  const init = { method, headers: new Headers(headers) };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    init.body = JSON.stringify(body);
    init.headers.set('Content-Type', 'application/json');
  }
  return new Request(url, init);
}
