/**
 * Configuration Service
 * Centralizes all configuration values for the chat service
 */

export const AppConfig = {
  // API Configuration
  api: {
    // Note: Ensure this model name is valid for your OpenAI API access
    // Common valid models: 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-mini', 'o1-preview'
    defaultModel: 'gpt-5-mini', // If this model doesn't exist, use 'gpt-4o-mini' or 'gpt-3.5-turbo'
    maxTokens: 800,
    defaultPromptType: 'standardAssistant',
  },

  // Error Message Templates
  errorMessages: {
    missingMessage: "Message is required",
    apiUnsupported: "This endpoint only supports server-sent events (SSE) requests or history requests.",
    authFailed: "Authentication failed with OpenAI API",
    apiKeyError: "Please check your API key in environment variables",
    rateLimitExceeded: "Rate limit exceeded",
    rateLimitDetails: "Please try again later",
    genericError: "Failed to get response from OpenAI"
  },

  // Conversation Configuration
  conversation: {
    maxHistoryMessages: 20
  },

  // Tool Configuration
  tools: {
    productSearchName: "search_shop_catalog",
    maxProductsToDisplay: 5,
    maxFitmentSearchProducts: 20, // Broader result set for fitment alternative searches
    extractAllProductDetails: true
  },

  // Timeout Configuration (milliseconds)
  timeouts: {
    storefrontMcpMs: 2000,      // Storefront MCP tools/list (2s, cache makes this rare)
    customerMcpMs: 500,          // Customer MCP tools/list (optional, graceful fallback)
    fitmentAutoSearchMs: 3000,   // Fitment auto-search tools/call (AI can retry via tool call)
  }
};

export default AppConfig;
