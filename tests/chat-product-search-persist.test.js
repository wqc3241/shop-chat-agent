/**
 * Tests that the explicit product search path in chat.jsx persists
 * AI responses to the database via saveMessage().
 *
 * Bug context: Prior to commit 2fb023c, the early-return path for explicit
 * product searches streamed the response via SSE but never called saveMessage().
 * This caused chat history to disappear on page navigation and AI responses
 * to be invisible in the admin live chat dashboard.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Shared state between mock factory and test code
const shared = vi.hoisted(() => ({
  streamDone: null,
  capturedMessages: [],
  toolCalls: [],
  savedMessages: [],
}));

vi.mock('../app/mcp-client', () => ({
  default: class MockMCPClient {
    constructor() {
      this.tools = [];
      this.customerMcpEndpoint = null;
    }
    async connectToStorefrontServer() {
      return [{ name: 'search_shop_catalog', description: 'Search catalog', inputSchema: {} }];
    }
    async connectToCustomerServer() { return []; }
    async callTool(name, args) {
      shared.toolCalls.push({ name, args });
      return {
        content: [{
          text: JSON.stringify({
            products: [{
              title: 'BC Racing BR Coilovers - Audi A4 B9',
              handle: 'bc-racing-br-coilovers-audi-a4-b9',
              description: 'Fits 2017-2025 Audi A4/A5 B9 platform.',
              url: 'https://dev-nlp-brochure.myshopify.com/products/bc-racing-br-coilovers-audi-a4-b9',
              variants: [{ sku: 'BC-A4-BR', price: '1395.00', currency: 'USD' }],
              tags: ['suspension', 'coilover'],
            }],
          }),
        }],
      };
    }
  },
}));

vi.mock('../app/services/config.server', () => ({
  default: {
    api: { defaultModel: 'gpt-4o-mini', defaultPromptType: 'standardAssistant', maxTokens: 1200 },
    conversation: { maxHistoryMessages: 20 },
    timeouts: { storefrontMcpMs: 5000, customerMcpMs: 500, fitmentAutoSearchMs: 5000 },
    tools: { productSearchName: 'search_shop_catalog', maxProductsToDisplay: 4, maxFitmentSearchProducts: 20 },
    errorMessages: { missingMessage: 'Message is required', apiUnsupported: 'Unsupported request' },
  },
}));

vi.mock('../app/services/streaming.server', () => ({
  createSseStream: vi.fn((callback) => {
    shared.capturedMessages = [];
    return new Response(
      new ReadableStream({
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
          }).catch(() => {
            try { controller.close(); } catch {}
          });
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  }),
}));

vi.mock('../app/services/openai.server', () => ({
  createOpenAIService: vi.fn(() => ({
    streamConversation: vi.fn(async () => ({
      role: 'assistant',
      content: [{ type: 'text', text: 'Should not reach OpenAI for explicit product search' }],
      stop_reason: 'end_turn',
    })),
  })),
}));

vi.mock('../app/services/tool.server', () => ({
  createToolService: vi.fn(() => ({
    processProductSearchResult: vi.fn((toolResponse) => {
      const parsed = JSON.parse(toolResponse.content[0].text);
      return parsed.products.map((product) => ({
        ...product,
        price: 'USD 1395.00',
        image_url: '',
        available: true,
        images: [],
        specifications: {},
        vendor: null,
        productType: null,
        collections: [],
      }));
    }),
  })),
}));

vi.mock('../app/services/websearch.server', () => ({
  getWebSearchTool: vi.fn(() => ({ name: 'web_search', description: 'Search web', inputSchema: {} })),
  executeWebSearch: vi.fn(async () => ({ content: [] })),
}));

vi.mock('../app/services/cache.server', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  CACHE_KEYS: { customerAccountUrls: () => 'test' },
  CACHE_TTL: { customerAccountUrls: 3600 },
}));

// Mock db.server — capture saveMessage calls for assertions
vi.mock('../app/db.server', () => ({
  saveMessage: vi.fn(async (...args) => {
    shared.savedMessages.push(args);
    return {};
  }),
  getConversationHistory: vi.fn(async () => []),
  storeCustomerAccountUrls: vi.fn(async () => ({})),
  getCustomerAccountUrls: vi.fn(async () => null),
  updateConversationMeta: vi.fn(async () => ({})),
  updateConversationOrders: vi.fn(async () => ({})),
  getChatSettings: vi.fn(async () => null),
  getConversation: vi.fn(async () => ({ mode: 'ai' })),
  getMessagesSince: vi.fn(async () => []),
  updateConversation: vi.fn(async () => ({})),
}));

const { action } = await import('../app/routes/chat.jsx');
const { saveMessage } = await import('../app/db.server');

describe('Explicit product search — response persistence', () => {
  afterEach(() => {
    shared.capturedMessages = [];
    shared.toolCalls = [];
    shared.savedMessages = [];
    vi.clearAllMocks();
  });

  it('saves the assistant response to the database for explicit product search', async () => {
    const conversationId = `persist_test_${Date.now()}`;
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://dev-nlp-brochure.myshopify.com',
      },
      body: JSON.stringify({
        message: 'help me find coilover for 2025 Audi',
        conversation_id: conversationId,
        current_page_url: 'https://dev-nlp-brochure.myshopify.com/',
      }),
    });

    const response = await action({ request });
    expect(response).toBeInstanceOf(Response);
    await shared.streamDone;

    // The product search should have been called
    expect(shared.toolCalls.some((call) => call.name === 'search_shop_catalog')).toBe(true);

    // saveMessage should be called at least twice: once for the user message, once for the assistant
    const assistantSaves = shared.savedMessages.filter(([, role]) => role === 'assistant');
    expect(assistantSaves.length).toBeGreaterThanOrEqual(1);

    // The assistant message content should be a JSON-stringified array with a text block
    const [savedConvId, savedRole, savedContent] = assistantSaves[0];
    expect(savedConvId).toBe(conversationId);
    expect(savedRole).toBe('assistant');

    const parsed = JSON.parse(savedContent);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].type).toBe('text');
    expect(parsed[0].text.length).toBeGreaterThan(0);
  });

  it('streams the status message AND persists it (not one or the other)', async () => {
    const conversationId = `stream_and_persist_${Date.now()}`;
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://dev-nlp-brochure.myshopify.com',
      },
      body: JSON.stringify({
        message: 'show me brake pads',
        conversation_id: conversationId,
        current_page_url: 'https://dev-nlp-brochure.myshopify.com/',
      }),
    });

    const response = await action({ request });
    await shared.streamDone;

    // SSE stream should contain a chunk with the status message
    const chunks = shared.capturedMessages.filter((m) => m.type === 'chunk');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const streamedText = chunks.map((c) => c.chunk).join('');

    // DB should have a matching assistant message
    const assistantSaves = shared.savedMessages.filter(([, role]) => role === 'assistant');
    expect(assistantSaves.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(assistantSaves[0][2]);
    const savedText = parsed[0].text;

    // The streamed text and saved text should match
    expect(savedText).toBe(streamedText);
  });

  it('persists the error fallback message when product search fails', async () => {
    // Override callTool to simulate failure
    const originalMock = (await import('../app/mcp-client')).default;
    const origCallTool = originalMock.prototype.callTool;
    originalMock.prototype.callTool = async () => ({ error: 'Connection timeout' });

    const conversationId = `error_persist_${Date.now()}`;
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://dev-nlp-brochure.myshopify.com',
      },
      body: JSON.stringify({
        message: 'find me some wheels',
        conversation_id: conversationId,
        current_page_url: 'https://dev-nlp-brochure.myshopify.com/',
      }),
    });

    const response = await action({ request });
    await shared.streamDone;

    // Should persist the error fallback message
    const assistantSaves = shared.savedMessages.filter(([, role]) => role === 'assistant');
    expect(assistantSaves.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(assistantSaves[0][2]);
    expect(parsed[0].text).toContain("couldn't find");

    // Restore
    originalMock.prototype.callTool = origCallTool;
  });

  it('saved content format matches what history endpoint returns to the client', async () => {
    const conversationId = `format_test_${Date.now()}`;
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://dev-nlp-brochure.myshopify.com',
      },
      body: JSON.stringify({
        message: 'show me exhaust systems',
        conversation_id: conversationId,
        current_page_url: 'https://dev-nlp-brochure.myshopify.com/',
      }),
    });

    await action({ request });
    await shared.streamDone;

    const assistantSaves = shared.savedMessages.filter(([, role]) => role === 'assistant');
    expect(assistantSaves.length).toBeGreaterThanOrEqual(1);

    // Verify the content is valid JSON that the client-side parser can handle
    const content = assistantSaves[0][2];
    const parsed = JSON.parse(content);

    // Must be an array of content blocks (same format as OpenAI onMessage produces)
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]).toHaveProperty('type', 'text');
    expect(parsed[0]).toHaveProperty('text');
    expect(typeof parsed[0].text).toBe('string');
  });

  it('product cards are still sent via SSE alongside the persisted message', async () => {
    const conversationId = `cards_test_${Date.now()}`;
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://dev-nlp-brochure.myshopify.com',
      },
      body: JSON.stringify({
        message: 'help me find coilover',
        conversation_id: conversationId,
        current_page_url: 'https://dev-nlp-brochure.myshopify.com/',
      }),
    });

    await action({ request });
    await shared.streamDone;

    // Product cards should be sent via SSE
    const productResults = shared.capturedMessages.filter((m) => m.type === 'product_results');
    expect(productResults.length).toBe(1);
    expect(productResults[0].products.length).toBeGreaterThan(0);

    // And the assistant message should also be saved
    const assistantSaves = shared.savedMessages.filter(([, role]) => role === 'assistant');
    expect(assistantSaves.length).toBeGreaterThanOrEqual(1);
  });
});
