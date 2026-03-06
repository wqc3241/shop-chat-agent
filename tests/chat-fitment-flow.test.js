import { describe, it, expect, vi, afterEach } from 'vitest';

const shared = vi.hoisted(() => ({
  streamDone: null,
  capturedMessages: [],
  openAiMessages: [],
  toolCalls: [],
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
              title: 'Air Lift Performance Front Kit',
              handle: 'air-lift-performance-front-kit-audi-a3-quattro-vw-golf-r-mqb-awd-2015-2024',
              description: 'Fits 2015-2024 Audi A3 Quattro and VW Golf R MQB AWD.',
              url: 'https://dev-nlp-brochure.myshopify.com/products/air-lift-performance-front-kit-audi-a3-quattro-vw-golf-r-mqb-awd-2015-2024',
              variants: [{ sku: 'SKU-1', price: '1020.00', currency: 'USD' }],
              tags: ['suspension'],
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
    streamConversation: vi.fn(async ({ messages }, handlers) => {
      shared.openAiMessages = messages;
      const fitmentContextPresent = messages.some((msg) =>
        Array.isArray(msg.content) &&
        msg.content.some((block) =>
          block.type === 'text' &&
          typeof block.text === 'string' &&
          block.text.includes('[AUTO-SEARCHED PRODUCT CONTEXT]')
        )
      );

      const reply = fitmentContextPresent
        ? "I can't confirm from the catalog data alone. The product description shows fitment through 2024, not 2020-specific Audi A3 trim verification."
        : 'Here are some matching products.';

      handlers.onText?.(reply);
      handlers.onMessage?.({
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
      });

      return {
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
        stop_reason: 'end_turn',
      };
    }),
  })),
}));

vi.mock('../app/services/tool.server', () => ({
  createToolService: vi.fn(() => ({
    processProductSearchResult: vi.fn((toolResponse) => {
      const parsed = JSON.parse(toolResponse.content[0].text);
      return parsed.products.map((product) => ({
        ...product,
        price: 'USD 1020.00',
        image_url: '',
        available: true,
        images: [],
        specifications: {},
        vendor: null,
        productType: null,
        collections: [],
      }));
    }),
    handleToolError: vi.fn(),
    handleToolSuccess: vi.fn(),
    addToolResultToHistory: vi.fn(),
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

vi.mock('../app/db.server', () => ({
  saveMessage: vi.fn(async () => ({})),
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

describe('Chat Fitment Flow', () => {
  afterEach(() => {
    shared.capturedMessages = [];
    shared.openAiMessages = [];
    shared.toolCalls = [];
  });

  it('returns text-only answer for fitment questions on a product page', async () => {
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://dev-nlp-brochure.myshopify.com',
      },
      body: JSON.stringify({
        message: 'is this parts fits my 2020 audi a3?',
        conversation_id: 'fitment_test_route',
        current_page_url: 'https://dev-nlp-brochure.myshopify.com/products/air-lift-performance-front-kit-audi-a3-quattro-vw-golf-r-mqb-awd-2015-2024',
      }),
    });

    const response = await action({ request });
    expect(response).toBeInstanceOf(Response);
    await shared.streamDone;

    expect(shared.toolCalls.some((call) => call.name === 'search_shop_catalog')).toBe(true);
    expect(shared.openAiMessages.some((msg) =>
      Array.isArray(msg.content) &&
      msg.content.some((block) => block.type === 'text' && block.text.includes('[AUTO-SEARCHED PRODUCT CONTEXT]'))
    )).toBe(true);

    const textChunks = shared.capturedMessages.filter((msg) => msg.type === 'chunk').map((msg) => msg.chunk).join('');
    expect(textChunks).toContain("I can't confirm from the catalog data alone");
    expect(shared.capturedMessages.some((msg) => msg.type === 'product_results')).toBe(false);
  });

  it('still returns product cards for explicit product search requests', async () => {
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://dev-nlp-brochure.myshopify.com',
      },
      body: JSON.stringify({
        message: 'show me brake pads',
        conversation_id: 'search_test_route',
        current_page_url: 'https://dev-nlp-brochure.myshopify.com/',
      }),
    });

    const response = await action({ request });
    expect(response).toBeInstanceOf(Response);
    await shared.streamDone;

    expect(shared.capturedMessages.some((msg) => msg.type === 'product_results')).toBe(true);
  });
});
