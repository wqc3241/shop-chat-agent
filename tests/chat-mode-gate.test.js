/**
 * Tests for the chat route's mode gate, poll, and history endpoints.
 * Tests the loader/action in app/routes/chat.jsx for live-chat behavior.
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import {
  createTestConversation,
  createTestMessage,
  cleanupConversations,
  disconnectPrisma,
} from './test-helper.js';
import { getConversation } from '../app/db.server.js';

// Shared state between mock factory and test code (vi.hoisted survives hoisting)
const shared = vi.hoisted(() => ({
  streamDone: null,
  capturedMessages: [],
}));

// We need to mock heavy dependencies that chat.jsx imports
vi.mock('../app/mcp-client', () => ({
  default: class MockMCPClient {
    constructor() {
      this.tools = [];
      this.customerMcpEndpoint = null;
    }
    async connectToStorefrontServer() { return []; }
    async connectToCustomerServer() { return []; }
    async callTool() { return { content: [] }; }
  },
}));

vi.mock('../app/services/config.server', () => ({
  default: {
    api: { defaultModel: 'gpt-4o-mini', defaultPromptType: 'standardAssistant' },
    conversation: { maxHistoryMessages: 20 },
    timeouts: { storefrontMcpMs: 5000, customerMcpMs: 500, fitmentAutoSearchMs: 5000 },
    tools: { productSearchName: 'search_shop_catalog' },
    errorMessages: { missingMessage: 'Message is required', apiUnsupported: 'Unsupported request' },
  },
}));

vi.mock('../app/services/streaming.server', () => ({
  createSseStream: vi.fn((callback) => {
    shared.capturedMessages = [];
    return new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const stream = {
          sendMessage: (msg) => {
            shared.capturedMessages.push(msg);
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`)); } catch {}
          },
          sendError: (err) => {
            shared.capturedMessages.push(err);
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(err)}\n\n`)); } catch {}
          },
        };
        shared.streamDone = callback(stream).then(() => {
          try { controller.close(); } catch {}
        }).catch((err) => {
          console.error('Stream callback error:', err);
          try { controller.close(); } catch {}
        });
      },
    });
  }),
}));

vi.mock('../app/services/openai.server', () => ({
  createOpenAIService: vi.fn(() => ({
    streamConversation: vi.fn(async () => ({ stop_reason: 'end_turn', role: 'assistant', content: 'test' })),
  })),
}));

vi.mock('../app/services/tool.server', () => ({
  createToolService: vi.fn(() => ({})),
}));

vi.mock('../app/services/websearch.server', () => ({
  getWebSearchTool: vi.fn(() => ({ name: 'web_search', description: 'Search', inputSchema: {} })),
  executeWebSearch: vi.fn(async () => ({ content: [] })),
}));

vi.mock('../app/services/cache.server', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  CACHE_KEYS: { customerAccountUrls: () => 'test' },
  CACHE_TTL: { customerAccountUrls: 3600 },
}));

const { loader, action } = await import('../app/routes/chat.jsx');

describe('Chat Route — Mode Gate & Polling', () => {
  const createdIds = [];

  afterEach(async () => {
    await cleanupConversations(createdIds.splice(0));
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  // ── History endpoint ───────────────────────────────────────────────

  describe('history endpoint', () => {
    it('returns messages and mode field', async () => {
      const conv = await createTestConversation({ mode: 'merchant' });
      createdIds.push(conv.id);
      await createTestMessage(conv.id, 'user', 'Help me');
      await createTestMessage(conv.id, 'assistant', 'Sure thing');

      const request = new Request(
        `http://localhost/chat?history=true&conversation_id=${conv.id}`,
        { method: 'GET', headers: { Accept: 'application/json' } }
      );
      const result = await loader({ request });

      expect(result).toBeInstanceOf(Response);
      const body = await result.json();
      expect(body.messages.length).toBe(2);
      expect(body.mode).toBe('merchant');
    });

    it('returns ai mode for unknown conversation', async () => {
      const request = new Request(
        `http://localhost/chat?history=true&conversation_id=nonexistent_${Date.now()}`,
        { method: 'GET', headers: { Accept: 'application/json' } }
      );
      const result = await loader({ request });
      const body = await result.json();
      expect(body.mode).toBe('ai');
    });
  });

  // ── Poll endpoint ──────────────────────────────────────────────────

  describe('poll endpoint', () => {
    it('returns merchant messages and current mode', async () => {
      const conv = await createTestConversation({ mode: 'merchant' });
      createdIds.push(conv.id);

      const cutoff = new Date();
      await new Promise(r => setTimeout(r, 50));
      await createTestMessage(conv.id, 'merchant', 'Hi from merchant');
      await createTestMessage(conv.id, 'user', 'Thanks');

      const request = new Request(
        `http://localhost/chat?poll=true&conversation_id=${conv.id}&since=${cutoff.toISOString()}`,
        { method: 'GET' }
      );
      const result = await loader({ request });

      expect(result).toBeInstanceOf(Response);
      const body = await result.json();
      // Only merchant messages should be returned
      expect(body.messages.length).toBe(1);
      expect(body.messages[0].role).toBe('merchant');
      expect(body.mode).toBe('merchant');
    });
  });

  // ── request_human sets pending_merchant mode ───────────────────────

  describe('request_human flag', () => {
    it('sets pending_merchant mode when request_human is true', async () => {
      const conv = await createTestConversation();
      createdIds.push(conv.id);

      const request = new Request('http://localhost/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://test-shop.myshopify.com',
        },
        body: JSON.stringify({
          message: 'I want to talk to a human',
          conversation_id: conv.id,
          request_human: true,
        }),
      });

      // action returns an SSE stream Response
      const response = await action({ request });
      expect(response).toBeInstanceOf(Response);

      // Wait for the stream callback to complete
      await shared.streamDone;

      // Check that the conversation mode was updated
      const updated = await getConversation(conv.id);
      expect(updated.mode).toBe('pending_merchant');
    });
  });

  // ── Mode gate short-circuits when merchant is active ───────────────

  describe('mode gate', () => {
    it('short-circuits SSE with mode event when conversation is in merchant mode', async () => {
      const conv = await createTestConversation({
        mode: 'merchant',
        assignedTo: 'staff_1',
        handoffAt: new Date(),
      });
      createdIds.push(conv.id);

      const request = new Request('http://localhost/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://test-shop.myshopify.com',
        },
        body: JSON.stringify({
          message: 'Hello',
          conversation_id: conv.id,
        }),
      });

      const response = await action({ request });
      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      // Wait for the stream callback to complete
      await shared.streamDone;

      // Verify captured messages contain mode event and end_turn
      const modeEvent = shared.capturedMessages.find(m => m.type === 'mode');
      const endTurnEvent = shared.capturedMessages.find(m => m.type === 'end_turn');

      expect(modeEvent).toBeTruthy();
      expect(modeEvent.mode).toBe('merchant');
      expect(endTurnEvent).toBeTruthy();
    });
  });
});
