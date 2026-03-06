/**
 * Chat API Route
 * Handles chat interactions with OpenAI API and tools
 */
import MCPClient from "../mcp-client";
import { saveMessage, getConversationHistory, storeCustomerAccountUrls, getCustomerAccountUrls as getCustomerAccountUrlsFromDb, updateConversationMeta, updateConversationOrders, getChatSettings, getConversation, getMessagesSince, updateConversation } from "../db.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createOpenAIService } from "../services/openai.server";
import { createToolService } from "../services/tool.server";
import { getWebSearchTool, executeWebSearch } from "../services/websearch.server";
import { cacheGet, cacheSet, CACHE_KEYS, CACHE_TTL } from "../services/cache.server";


/**
 * Rract Router loader function for handling GET requests
 */
export async function loader({ request }) {
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);

  // Handle storefront polling for merchant messages
  if (url.searchParams.has('poll') && url.searchParams.has('conversation_id')) {
    return handlePollRequest(request, url);
  }

  // Handle history fetch requests - matches /chat?history=true&conversation_id=XYZ
  if (url.searchParams.has('history') && url.searchParams.has('conversation_id')) {
    return handleHistoryRequest(request, url.searchParams.get('conversation_id'));
  }

  // Handle SSE requests
  if (!url.searchParams.has('history') && request.headers.get("Accept") === "text/event-stream") {
    return handleChatRequest(request);
  }

  // API-only: reject all other requests
  return new Response(JSON.stringify({ error: AppConfig.errorMessages.apiUnsupported }), { status: 400, headers: getCorsHeaders(request) });
}

/**
 * React Router action function for handling POST requests
 */
export async function action({ request }) {
  return handleChatRequest(request);
}

/**
 * Handle history fetch requests
 * @param {Request} request - The request object
 * @param {string} conversationId - The conversation ID
 * @returns {Response} JSON response with chat history
 */
async function handleHistoryRequest(request, conversationId) {
  const [messages, conversation] = await Promise.all([
    getConversationHistory(conversationId),
    getConversation(conversationId),
  ]);

  return new Response(JSON.stringify({
    messages,
    mode: conversation?.mode || 'ai',
  }), { headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } });
}

/**
 * Handle storefront polling for new merchant messages
 * @param {Request} request - The request object
 * @param {URL} url - Parsed URL
 * @returns {Response} JSON response with new messages and mode
 */
async function handlePollRequest(request, url) {
  const conversationId = url.searchParams.get('conversation_id');
  const since = url.searchParams.get('since');

  const [conversation, messages] = await Promise.all([
    getConversation(conversationId),
    since ? getMessagesSince(conversationId, since) : Promise.resolve([]),
  ]);

  // Return merchant + assistant messages (assistant = system messages from handoff/release).
  // Customer's own messages are already displayed locally; AI responses come via SSE.
  // During merchant mode the mode gate blocks AI, so assistant messages are only system notices.
  const merchantMessages = messages.filter(m => m.role === 'merchant' || m.role === 'assistant');

  return new Response(JSON.stringify({
    messages: merchantMessages,
    mode: conversation?.mode || 'ai',
  }), { headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } });
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  try {
    // Parse request body — handle both JSON and form-encoded (Shopify app proxy
    // converts application/json to application/x-www-form-urlencoded)
    let body;
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // App proxy form-encoded or other formats: try JSON parse of the raw text
      const rawText = await request.text();
      try {
        body = JSON.parse(rawText);
      } catch {
        // Fall back to parsing as form data
        const params = new URLSearchParams(rawText);
        body = Object.fromEntries(params.entries());
      }
    }
    const userMessage = body.message;
    const currentPageUrl = body.current_page_url || '';
    const requestHuman = body.request_human === true || body.request_human === 'true';
    const expectedMode = body.expected_mode || null;

    // Validate required message
    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || AppConfig.api.defaultPromptType;

    // Create a stream for the response
    const responseStream = createSseStream(async (stream) => {
      await handleChatSession({
        request,
        userMessage,
        conversationId,
        promptType,
        currentPageUrl,
        stream,
        requestHuman,
        expectedMode,
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request)
    });
  } catch (error) {
    console.error('Error in chat request handler:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: getCorsHeaders(request)
    });
  }
}

/**
 * Handle a complete chat session
 * @param {Object} params - Session parameters
 * @param {Request} params.request - The request object
 * @param {string} params.userMessage - The user's message
 * @param {string} params.conversationId - The conversation ID
 * @param {string} params.promptType - The prompt type
 * @param {string} params.currentPageUrl - The current page URL
 * @param {Object} params.stream - Stream manager for sending responses
 */
async function handleChatSession({
  request,
  userMessage,
  conversationId,
  promptType,
  currentPageUrl,
  stream,
  requestHuman,
  expectedMode,
}) {
  const openaiService = createOpenAIService();
  const toolService = createToolService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const shopDomain = request.headers.get("Origin");

  // Create MCP client without customer endpoint initially (resolved in parallel below)
  const mcpClient = new MCPClient(shopDomain, conversationId, shopId, null);

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });

    // ── Mode gate: check if a merchant has taken over this conversation ──
    // Save the user message first so the merchant can see it
    await saveMessage(conversationId, 'user', userMessage);

    const conversation = await getConversation(conversationId);

    // If client expected a different mode, inform them of the actual mode
    if (expectedMode && conversation && expectedMode !== conversation.mode) {
      stream.sendMessage({ type: 'mode', mode: conversation.mode });
    }

    // Handle "request human" — set pending_merchant mode
    if (requestHuman && conversation) {
      await updateConversation(conversationId, { mode: 'pending_merchant' });
    }

    // If merchant is active, short-circuit — skip AI entirely
    if (conversation && conversation.mode === 'merchant') {
      stream.sendMessage({ type: 'mode', mode: 'merchant' });
      stream.sendMessage({ type: 'end_turn' });
      return;
    }

    // Extract shop hostname for DB linking
    let shopHostname = null;
    try {
      if (shopDomain) shopHostname = new URL(shopDomain).hostname;
    } catch { /* ignore parse errors */ }

    // Phase 1: Fire independent operations in parallel for faster TTFT
    // saveMessage → getConversationHistory must be sequential (history needs the saved message)
    // but they run in parallel with MCP connections
    // Update conversation meta (message already saved in mode gate above)
    if (shopHostname) {
      updateConversationMeta(conversationId, {
        shop: shopHostname,
        ...(currentPageUrl ? { pageUrl: currentPageUrl } : {}),
      }).catch(() => {});
    }

    const [customerUrlsResult, storefrontResult, dbMessagesResult, chatSettingsResult] = await Promise.allSettled([
      getCustomerAccountUrls(shopDomain, conversationId),
      withTimeout(mcpClient.connectToStorefrontServer(), AppConfig.timeouts.storefrontMcpMs, 'storefront MCP connection timed out'),
      getConversationHistory(conversationId),
      // Fetch merchant's custom instructions
      shopHostname ? getChatSettings(shopHostname) : Promise.resolve(null),
    ]);

    let storefrontMcpTools = [];
    if (storefrontResult.status === 'fulfilled') {
      storefrontMcpTools = storefrontResult.value;
      console.log(`Connected to storefront MCP with ${storefrontMcpTools.length} tools`);
    } else {
      console.warn('Failed to connect to storefront MCP server:', storefrontResult.reason?.message);
    }

    // Detect page context and user intent early (needed for Phase 2 parallelization)
    const isProductPage = currentPageUrl && currentPageUrl.includes('/products/');
    const isFitmentQuestion = /fit|fits|compatible|compatibility|will this work|does this fit|will it fit|vehicle|car|truck|suv/i.test(userMessage);
    const isExplicitProductSearch = isExplicitProductSearchRequest(userMessage);
    const currentProductHandle = isProductPage
      ? (currentPageUrl.match(/\/products\/([^?&#]+)/) || [])[1] || null
      : null;

    // Phase 2: Run customer MCP connection and fitment auto-search in parallel
    // (both depend on Phase 1 results but are independent of each other)
    const customerMcpPromise = (async () => {
      if (customerUrlsResult.status === 'fulfilled' && customerUrlsResult.value?.mcpApiUrl) {
        mcpClient.customerMcpEndpoint = customerUrlsResult.value.mcpApiUrl;
        return withTimeout(mcpClient.connectToCustomerServer(), AppConfig.timeouts.customerMcpMs, 'customer MCP connection timed out');
      }
      return [];
    })().catch(error => {
      console.warn('Customer MCP unavailable/slow, continuing without it:', error.message);
      return [];
    });

    const fitmentSearchPromise = (async () => {
      if (isProductPage && isFitmentQuestion && currentProductHandle && storefrontMcpTools.length > 0) {
        console.log(`Auto-searching for product: ${currentProductHandle}`);
        const result = await withTimeout(
          mcpClient.callTool(AppConfig.tools.productSearchName, {
            query: currentProductHandle,
            context: `User is viewing product page: ${currentPageUrl}. They are asking about fitment/compatibility.`
          }),
          AppConfig.timeouts.fitmentAutoSearchMs,
          'fitment auto-search timed out'
        );
        if (result && !result.error && result.content) return result;
      }
      return null;
    })().catch(error => {
      console.warn('Fitment auto-search failed, AI will search via tool call:', error.message);
      return null;
    });

    // Wait for both Phase 2 operations
    const [customerMcpTools, fitmentSearchResult] = await Promise.all([customerMcpPromise, fitmentSearchPromise]);
    if (customerMcpTools.length > 0) {
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
    }

    // Always expose web_search to the model for external/current-info questions.
    const webSearchTool = getWebSearchTool();
    if (!mcpClient.tools.some(tool => tool.name === webSearchTool.name)) {
      mcpClient.tools.push(webSearchTool);
    }

    // Prepare conversation state
    let productsToDisplay = [];
    let shouldReturnProductCardsOnly = false;
    let explicitSearchStatusMessage = "";

    // Format messages for OpenAI API
    const dbMessages = dbMessagesResult.status === 'fulfilled' ? dbMessagesResult.value : [];
    let conversationHistory = dbMessages.map(dbMessage => {
      let content;
      try {
        content = JSON.parse(dbMessage.content);
      } catch (e) {
        content = dbMessage.content;
      }
      // Map merchant messages to assistant role so OpenAI has context
      const role = dbMessage.role === 'merchant' ? 'assistant' : dbMessage.role;
      return { role, content };
    });

    // Sliding window: limit conversation history to prevent unbounded token growth
    if (conversationHistory.length > AppConfig.conversation.maxHistoryMessages) {
      conversationHistory = conversationHistory.slice(-AppConfig.conversation.maxHistoryMessages);
    }

    // If customer requested a human, inject context for the AI to acknowledge
    if (requestHuman) {
      conversationHistory.push({
        role: 'user',
        content: [{ type: 'text', text: '[SYSTEM] The customer has requested to speak with a human team member. Acknowledge this in your response and let them know a team member has been notified and will join shortly. Continue assisting them in the meantime.' }]
      });
    }

    // If fitment auto-search returned product data, inject it into conversation context
    if (fitmentSearchResult) {
      try {
        const content = Array.isArray(fitmentSearchResult.content)
          ? fitmentSearchResult.content[0]?.text || JSON.stringify(fitmentSearchResult.content)
          : typeof fitmentSearchResult.content === 'string'
          ? fitmentSearchResult.content
          : JSON.stringify(fitmentSearchResult.content);

        let parsedContent;
        try { parsedContent = typeof content === 'string' ? JSON.parse(content) : content; }
        catch { parsedContent = { text: content }; }

        const products = parsedContent?.products || (parsedContent?.text ? JSON.parse(parsedContent.text)?.products : null);
        let productInfo;
        if (products && products.length > 0) {
          const p = products[0];
          const sku = p.variants?.length > 0
            ? p.variants[0].sku || p.variants.map(v => v.sku).filter(Boolean).join(', ')
            : p.sku || 'N/A';
          productInfo = `Product Title: ${p.title || 'N/A'}\nProduct SKU: ${sku}\nProduct Description: ${p.description || p.body_html || 'N/A'}\nProduct Tags: ${(p.tags || []).join(', ')}\nProduct URL: ${p.url || currentPageUrl}\nAll Product Details: ${JSON.stringify(p)}`;
        } else {
          productInfo = JSON.stringify(parsedContent);
        }

        conversationHistory.push({
          role: 'user',
          content: [{ type: 'text', text: `[AUTO-SEARCHED PRODUCT CONTEXT] Customer is viewing: ${currentPageUrl}. Product details:\n\n${productInfo}\n\nUse this to answer the customer's fitment/compatibility question.` }]
        });
        console.log('Added auto-searched product context to conversation history');
      } catch (error) {
        console.error('Error formatting product context:', error);
      }
    }

    // If user explicitly asks to find/search products, proactively run catalog search
    // so this works consistently from any storefront page.
    if (isExplicitProductSearch && storefrontMcpTools.length > 0 && !(isProductPage && isFitmentQuestion)) {
      try {
        const productQuery = extractProductSearchQuery(userMessage);
        const useFuzzyTopTen = isNonSpecificProductQuery(productQuery);
        const searchArgs = {
          query: productQuery,
          context: [
            "User explicitly asked to find products in chat.",
            useFuzzyTopTen ? "Query is broad/non-specific: return broad matches." : "Query is specific: prioritize exact relevance.",
            currentPageUrl ? `Current page: ${currentPageUrl}` : null,
            `Original request: ${userMessage}`
          ].filter(Boolean).join(" ")
        };

        stream.sendMessage({
          type: 'tool_use',
          tool_use_message: `Calling tool: ${AppConfig.tools.productSearchName} with arguments: ${JSON.stringify(searchArgs)}`
        });

        const proactiveSearchResult = await mcpClient.callTool(AppConfig.tools.productSearchName, searchArgs);

        if (proactiveSearchResult && !proactiveSearchResult.error) {
          const proactiveProducts = toolService.processProductSearchResult(
            proactiveSearchResult,
            useFuzzyTopTen ? 10 : undefined
          );
          if (proactiveProducts.length > 0) {
            productsToDisplay.push(...proactiveProducts);
            shouldReturnProductCardsOnly = true;
            explicitSearchStatusMessage = buildShortSearchStatusMessage(productQuery, proactiveProducts);

            const productSummary = proactiveProducts.map((product, index) => (
              `${index + 1}. ${product.title} | ${product.price} | ${product.url || 'No URL'}`
            )).join('\n');

            conversationHistory.push({
              role: 'user',
              content: [{
                type: 'text',
                text: `[AUTO-SEARCHED PRODUCT RESULTS] The user asked to find products with query "${productQuery}". Use these results to answer naturally and helpfully.\n\n${productSummary}`
              }]
            });
          }
          else {
            shouldReturnProductCardsOnly = true;
            explicitSearchStatusMessage = "I couldn't find an exact match. Try a different keyword and I'll search again.";
          }
        } else {
          console.warn('Proactive product search failed:', proactiveSearchResult?.error);
          shouldReturnProductCardsOnly = true;
          explicitSearchStatusMessage = "I couldn't find results this time. Please try a different keyword.";
        }
      } catch (error) {
        console.error('Error in proactive product search:', error);
        shouldReturnProductCardsOnly = true;
        explicitSearchStatusMessage = "Something went wrong during search. Please try again in a moment.";
      }
    }

    // For explicit product-finding requests, return a short status message
    // plus product cards (if any), without generating long assistant text.
    if (isExplicitProductSearch && shouldReturnProductCardsOnly) {
      if (explicitSearchStatusMessage) {
        stream.sendMessage({
          type: 'chunk',
          chunk: explicitSearchStatusMessage
        });
        stream.sendMessage({ type: 'message_complete' });
      }
      stream.sendMessage({ type: 'end_turn' });
      if (productsToDisplay.length > 0) {
        stream.sendMessage({
          type: 'product_results',
          products: productsToDisplay
        });
      }
      return;
    }

    // Extract merchant's custom instructions (if any)
    const customInstructions = chatSettingsResult?.status === 'fulfilled'
      ? chatSettingsResult.value?.customInstructions || ''
      : '';

    // Execute the conversation stream
    let finalMessage = { role: 'user', content: userMessage };
    let iterationCount = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (finalMessage.stop_reason !== "end_turn" && iterationCount < maxIterations) {
      iterationCount++;
      try {
        finalMessage = await openaiService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools,
          customInstructions,
        },
        {
          // Handle text chunks
          onText: (textDelta) => {
            stream.sendMessage({
              type: 'chunk',
              chunk: textDelta
            });
          },

          // Handle complete messages
          onMessage: (message) => {
            conversationHistory.push({
              role: message.role,
              content: message.content
            });

            saveMessage(conversationId, message.role, JSON.stringify(message.content))
              .catch((error) => {
                console.error("Error saving message to database:", error);
              });

            // Send a completion message
            stream.sendMessage({ type: 'message_complete' });
          },

          // Handle tool use requests
          onToolUse: async (content) => {
            const toolName = content.name;
            let toolArgs = content.input || {};
            const toolUseId = content.id;

            // Prevent the AI from re-searching the same product it already looked up
            // in a previous tool call within this conversation turn.
            // Category-based searches (e.g. "brake pads") always pass through
            // so the fitment alternative workflow works.
            if (toolName === AppConfig.tools.productSearchName && currentProductHandle) {
              const alreadySearchedThisProduct = conversationHistory.some(msg => {
                if (msg.role === 'user' && Array.isArray(msg.content)) {
                  return msg.content.some(block =>
                    block.type === 'tool_result' &&
                    typeof block.content === 'string' &&
                    block.content.includes(currentProductHandle)
                  );
                }
                return false;
              });

              const queryTargetsSameProduct = typeof toolArgs.query === 'string'
                && toolArgs.query.toLowerCase().includes(currentProductHandle.toLowerCase());

              if (alreadySearchedThisProduct && queryTargetsSameProduct) {
                console.log('Skipping redundant search for same product');
                await toolService.addToolResultToHistory(
                  conversationHistory,
                  toolUseId,
                  { message: 'Product details already retrieved - use existing context', skipSearch: true },
                  conversationId
                );
                stream.sendMessage({ type: 'new_message' });
                return;
              }
            }

            // Fix missing required parameters for search_shop_catalog tool
            if (toolName === AppConfig.tools.productSearchName) {
              // If query is missing, extract from user's message or current page
              if (!toolArgs.query || toolArgs.query === '') {
                // First, try to extract from current page URL if on product page
                if (currentPageUrl && currentPageUrl.includes('/products/')) {
                  const urlMatch = currentPageUrl.match(/\/products\/([^?&#]+)/);
                  if (urlMatch) {
                    toolArgs.query = urlMatch[1]; // Use product handle
                  }
                }
                
                // If still no query, get from user's message
                if (!toolArgs.query || toolArgs.query === '') {
                  const userMessages = conversationHistory.filter(msg => msg.role === 'user');
                  if (userMessages.length > 0) {
                    const lastUserMessage = userMessages[userMessages.length - 1];
                    let messageText = '';
                    
                    if (typeof lastUserMessage.content === 'string') {
                      messageText = lastUserMessage.content;
                    } else if (Array.isArray(lastUserMessage.content)) {
                      messageText = lastUserMessage.content
                        .filter(block => block.type === 'text')
                        .map(block => block.text || block.content)
                        .join(' ');
                    }
                    
                    if (messageText) {
                      toolArgs.query = messageText;
                    }
                  }
                }
              }
              
              // If context is missing, try to extract from current page or set default
              if (!toolArgs.context || toolArgs.context === '') {
                // Get the most recent user message for context
                const userMessages = conversationHistory.filter(msg => msg.role === 'user');
                let contextText = 'General product inquiry';
                
                if (userMessages.length > 0) {
                  const lastUserMessage = userMessages[userMessages.length - 1];
                  if (typeof lastUserMessage.content === 'string') {
                    contextText = lastUserMessage.content;
                  } else if (Array.isArray(lastUserMessage.content)) {
                    contextText = lastUserMessage.content
                      .filter(block => block.type === 'text')
                      .map(block => block.text || block.content)
                      .join(' ');
                  }
                }
                
                // Build comprehensive context
                let contextParts = [];
                if (currentPageUrl && currentPageUrl.includes('/products/')) {
                  contextParts.push(`User is viewing product page: ${currentPageUrl}`);
                }
                contextParts.push(contextText);
                toolArgs.context = contextParts.join('. ');
              }
            }

            const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;

            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });

            // Call the tool (handle web search separately)
            let toolUseResponse;
            if (toolName === 'web_search') {
              toolUseResponse = await executeWebSearch(toolArgs);
            } else {
              toolUseResponse = await mcpClient.callTool(toolName, toolArgs);
            }

            // Extract order numbers from order-related tool calls
            if ((toolName === 'get_order_status' || toolName === 'get_most_recent_order_status') && !toolUseResponse.error) {
              try {
                const resultText = Array.isArray(toolUseResponse.content)
                  ? toolUseResponse.content[0]?.text || JSON.stringify(toolUseResponse.content)
                  : typeof toolUseResponse.content === 'string'
                    ? toolUseResponse.content
                    : JSON.stringify(toolUseResponse.content);
                // Match order numbers like #1001, 1001, or "name":"#1001"
                const orderMatches = resultText.match(/#?\d{4,}/g);
                if (orderMatches) {
                  for (const match of orderMatches) {
                    const orderNum = match.startsWith('#') ? match : `#${match}`;
                    updateConversationOrders(conversationId, orderNum).catch(() => {});
                  }
                }
                // Also check tool arguments
                if (toolArgs.order_number || toolArgs.orderNumber) {
                  const argOrder = toolArgs.order_number || toolArgs.orderNumber;
                  const orderNum = String(argOrder).startsWith('#') ? argOrder : `#${argOrder}`;
                  updateConversationOrders(conversationId, orderNum).catch(() => {});
                }
              } catch { /* best-effort extraction */ }
            }

            // Handle tool response based on success/error
            if (toolUseResponse.error) {
              await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                productsToDisplay,
                conversationId,
                toolArgs,
                currentProductHandle
              );
            }

            // Signal new message to client
            stream.sendMessage({ type: 'new_message' });
          },

          // Handle content block completion
          onContentBlock: (contentBlock) => {
            if (contentBlock.type === 'text') {
              stream.sendMessage({
                type: 'content_block_complete',
                content_block: contentBlock
              });
            }
          }
        }
      );
      } catch (error) {
        console.error("Error in streamConversation:", error);
        stream.sendError({
          type: 'error',
          error: 'Failed to process your message',
          details: error.message || 'An unexpected error occurred'
        });
        break; // Exit the loop on error
      }
    }

    if (iterationCount >= maxIterations) {
      console.warn("Reached maximum iterations, stopping conversation loop");
      stream.sendMessage({ type: 'end_turn' });
    }

    // Signal end of turn
    stream.sendMessage({ type: 'end_turn' });

    // Send product results if available
    if (productsToDisplay.length > 0) {
      stream.sendMessage({
        type: 'product_results',
        products: productsToDisplay
      });
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Get the customer MCP API URL for a shop
 * @param {string} shopDomain - The shop domain
 * @param {string} conversationId - The conversation ID
 * @returns {string} The customer MCP API URL
 */
async function getCustomerAccountUrls(shopDomain, conversationId) {
  try {
    // Layer 1: In-memory cache keyed by shop domain (instant)
    const cacheKey = CACHE_KEYS.customerAccountUrls(shopDomain);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // Layer 2: DB cache keyed by conversationId (fast, persists across restarts)
    const existingUrls = await getCustomerAccountUrlsFromDb(conversationId);
    if (existingUrls) {
      cacheSet(cacheKey, existingUrls, CACHE_TTL.customerAccountUrls);
      return existingUrls;
    }

    // Layer 3: Fresh fetch from well-known endpoints
    const { hostname } = new URL(shopDomain);

    const [mcpResponse, openidResponse] = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`).then(res => res.json()),
      fetch(`https://${hostname}/.well-known/openid-configuration`).then(res => res.json()),
    ]);

    const response = {
      mcpApiUrl: mcpResponse.mcp_api,
      authorizationUrl: openidResponse.authorization_endpoint,
      tokenUrl: openidResponse.token_endpoint,
    };

    // Persist to DB and in-memory cache
    await storeCustomerAccountUrls({
      conversationId,
      mcpApiUrl: mcpResponse.mcp_api,
      authorizationUrl: openidResponse.authorization_endpoint,
      tokenUrl: openidResponse.token_endpoint,
    });
    cacheSet(cacheKey, response, CACHE_TTL.customerAccountUrls);

    return response;
  } catch (error) {
    console.error("Error getting customer MCP API URL:", error);
    return null;
  }
}

/**
 * Gets CORS headers for the response
 * @param {Request} request - The request object
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400" // 24 hours
  };
}

/**
 * Get SSE headers for the response
 * @param {Request} request - The request object
 * @returns {Object} SSE headers object
 */
function getSseHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  };
}

function isExplicitProductSearchRequest(message = "") {
  if (!message || typeof message !== "string") return false;
  const text = message.trim().toLowerCase();
  if (!text) return false;

  const searchIntentPattern = /(?:\bfind\b|\bsearch\b|\blook for\b|\bshow me\b|\brecommend\b|\bneed\b.*\bproduct\b|帮我找|找一下|找个|搜索|查找|推荐.*产品|想买)/i;
  return searchIntentPattern.test(text);
}

function extractProductSearchQuery(message = "") {
  if (!message || typeof message !== "string") return "";

  let query = message.trim();

  // Remove common lead-in phrases (EN + ZH), keep the actual product keywords.
  query = query
    .replace(/^(please\s+)?(can you\s+)?(could you\s+)?(help me\s+)?/i, "")
    .replace(/^(i want to\s+|i'd like to\s+)?(find|search|look for|show me|recommend)\s+/i, "")
    .replace(/^(帮我|请帮我)?(找一下|找个|找|搜索|查找|推荐)\s*/i, "")
    .replace(/^(products?|product)\s*/i, "")
    .replace(/[?？!！。]+$/g, "")
    .trim();

  return query || message.trim();
}

function isNonSpecificProductQuery(query = "") {
  if (!query || typeof query !== "string") return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return true;
  if (normalized.length < 8) return true;

  const genericTerms = [
    "product", "products", "item", "items", "something", "anything",
    "配件", "产品", "东西", "推荐", "找"
  ];
  const nonGenericWordCount = words.filter((word) => !genericTerms.includes(word)).length;

  return nonGenericWordCount <= 1;
}

function buildShortSearchStatusMessage(query = "", products = []) {
  if (!Array.isArray(products) || products.length === 0) {
    return "I couldn't find matching products. Try a different keyword and I'll search again.";
  }

  if (hasLikelyExactMatch(query, products)) {
    return "Found matches — click a product card below to view details.";
  }

  return "I couldn't find an exact match, but I found similar products below.";
}

function hasLikelyExactMatch(query = "", products = []) {
  if (!query || typeof query !== "string" || !Array.isArray(products)) return false;

  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return false;

  // Fast path: full query appears in title
  const fullMatch = products.some((product) => {
    const title = (product?.title || "").toLowerCase();
    return title.includes(normalizedQuery);
  });
  if (fullMatch) return true;

  // Token overlap path
  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 2);
  if (queryTokens.length === 0) return false;

  return products.some((product) => {
    const title = (product?.title || "").toLowerCase();
    const matched = queryTokens.filter((token) => title.includes(token)).length;
    return matched >= Math.min(2, queryTokens.length);
  });
}

function withTimeout(promise, timeoutMs, timeoutMessage = "Operation timed out") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    ),
  ]);
}

