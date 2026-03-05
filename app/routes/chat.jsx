/**
 * Chat API Route
 * Handles chat interactions with OpenAI API and tools
 */
import "../env.server.js"; // Ensure environment variables are loaded
import MCPClient from "../mcp-client";
import { saveMessage, getConversationHistory, storeCustomerAccountUrls, getCustomerAccountUrls as getCustomerAccountUrlsFromDb } from "../db.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createOpenAIService } from "../services/openai.server";
import { createToolService } from "../services/tool.server";
import { getWebSearchTool, executeWebSearch } from "../services/websearch.server";


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
  const messages = await getConversationHistory(conversationId);

  return new Response(JSON.stringify({ messages }), { headers: getCorsHeaders(request) });
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  try {
    // Get message data from request body
    const body = await request.json();
    const userMessage = body.message;
    const currentPageUrl = body.current_page_url || '';

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
        stream
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
  stream
}) {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.jsx:115',message:'handleChatSession entry',data:{userMessage,conversationId,promptType,hasOpenAIKey:!!process.env.OPENAI_API_KEY,openAIKeyLength:process.env.OPENAI_API_KEY?.length||0,currentWorkingDir:process.cwd()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  // Initialize services
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.jsx:127',message:'BEFORE createOpenAIService call',data:{hasOpenAIKey:!!process.env.OPENAI_API_KEY,openAIKeyValue:process.env.OPENAI_API_KEY?.substring(0,15)||'undefined'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  const openaiService = createOpenAIService();
  const toolService = createToolService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const shopDomain = request.headers.get("Origin");
  const { mcpApiUrl } = await getCustomerAccountUrls(shopDomain, conversationId);

  const mcpClient = new MCPClient(
    shopDomain,
    conversationId,
    shopId,
    mcpApiUrl,
  );

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });

    // Connect MCP tools with latency-aware strategy:
    // - storefront tools are high-priority (product search)
    // - customer tools are optional for initial response and should not block too long
    let storefrontMcpTools = [], customerMcpTools = [];

    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      console.log(`Connected to storefront MCP with ${storefrontMcpTools.length} tools`);
    } catch (error) {
      console.warn('Failed to connect to storefront MCP server, continuing:', error.message);
    }

    try {
      customerMcpTools = await withTimeout(
        mcpClient.connectToCustomerServer(),
        1200,
        'customer MCP connection timed out'
      );
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
    } catch (error) {
      console.warn('Customer MCP unavailable/slow, continuing without it for this turn:', error.message);
    }

    // Always expose web_search to the model for external/current-info questions.
    const webSearchTool = getWebSearchTool();
    if (!mcpClient.tools.some(tool => tool.name === webSearchTool.name)) {
      mcpClient.tools.push(webSearchTool);
    }

    // Prepare conversation state
    let conversationHistory = [];
    let productsToDisplay = [];
    let shouldReturnProductCardsOnly = false;
    let explicitSearchStatusMessage = "";

    // Save user message to the database
    await saveMessage(conversationId, 'user', userMessage);

    // Fetch all messages from the database for this conversation
    const dbMessages = await getConversationHistory(conversationId);

    // Format messages for OpenAI API
    conversationHistory = dbMessages.map(dbMessage => {
      let content;
      try {
        content = JSON.parse(dbMessage.content);
      } catch (e) {
        content = dbMessage.content;
      }
      return {
        role: dbMessage.role,
        content
      };
    });

    // Detect if user is asking about product fitment on a product page
    const isProductPage = currentPageUrl && currentPageUrl.includes('/products/');
    const isFitmentQuestion = /fit|fits|compatible|compatibility|will this work|does this fit|will it fit|vehicle|car|truck|suv/i.test(userMessage);
    const isExplicitProductSearch = isExplicitProductSearchRequest(userMessage);
    
    // If on a product page and asking about fitment, automatically search for the current product
    if (isProductPage && isFitmentQuestion && storefrontMcpTools.length > 0) {
      try {
        // Extract product handle or ID from URL
        const urlMatch = currentPageUrl.match(/\/products\/([^?&#]+)/);
        if (urlMatch) {
          const productHandle = urlMatch[1];
          console.log(`Auto-searching for product from current page: ${productHandle}`);
          
          // Search for the product using the handle or title
          const productSearchResult = await mcpClient.callTool(AppConfig.tools.productSearchName, {
            query: productHandle,
            context: `User is viewing product page: ${currentPageUrl}. They are asking about fitment/compatibility. Please search for this specific product and provide all details including title, description, tags, and any vehicle compatibility information.`
          });
          
          // If product found, add it to conversation history as context
          if (productSearchResult && !productSearchResult.error && productSearchResult.content) {
            // Format product information for AI context
            let productInfo = '';
            try {
              const content = Array.isArray(productSearchResult.content) 
                ? productSearchResult.content[0]?.text || JSON.stringify(productSearchResult.content)
                : typeof productSearchResult.content === 'string'
                ? productSearchResult.content
                : JSON.stringify(productSearchResult.content);
              
              let parsedContent;
              if (typeof content === 'string') {
                try {
                  parsedContent = JSON.parse(content);
                } catch {
                  parsedContent = { text: content };
                }
              } else {
                parsedContent = content;
              }
              
              // Extract product details
              const products = parsedContent?.products || (parsedContent?.text ? JSON.parse(parsedContent.text)?.products : null);
              if (products && products.length > 0) {
                const product = products[0];
                // Extract SKU from variants if available
                const sku = product.variants && product.variants.length > 0 
                  ? product.variants[0].sku || product.variants.map(v => v.sku).filter(Boolean).join(', ')
                  : product.sku || 'N/A';
                
                productInfo = `Product Title: ${product.title || 'N/A'}\nProduct SKU: ${sku}\nProduct Description: ${product.description || product.body_html || 'N/A'}\nProduct Tags: ${(product.tags || []).join(', ')}\nProduct URL: ${product.url || currentPageUrl}\nProduct Specifications: ${JSON.stringify(product.specifications || {})}\nAll Product Details: ${JSON.stringify(product)}`;
              } else {
                productInfo = JSON.stringify(parsedContent);
              }
            } catch (error) {
              console.error('Error formatting product context:', error);
              productInfo = JSON.stringify(productSearchResult.content);
            }
            
            const productContext = {
              role: 'user',
              content: [{
                type: 'text',
                text: `[AUTO-SEARCHED PRODUCT CONTEXT] The customer is viewing this product page: ${currentPageUrl}. I automatically searched for and found the product details:\n\n${productInfo}\n\nPlease use this product information to answer the customer's question about fitment/compatibility.`
              }]
            };
            
            // Add product context before the user's question
            conversationHistory.push(productContext);
            console.log('Added product context to conversation history');
          }
        }
      } catch (error) {
        console.error('Error auto-searching for product:', error);
        // Continue with normal flow even if auto-search fails
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

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.jsx:177',message:'Before streamConversation call',data:{conversationHistoryLength:conversationHistory.length,toolsCount:mcpClient.tools.length,isProductPage,isFitmentQuestion,currentPageUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Execute the conversation stream
    let finalMessage = { role: 'user', content: userMessage };
    let iterationCount = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (finalMessage.stop_reason !== "end_turn" && iterationCount < maxIterations) {
      iterationCount++;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.jsx:185',message:'While loop iteration',data:{iterationCount,stopReason:finalMessage.stop_reason},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      try {
        finalMessage = await openaiService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools
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

            // Prevent redundant search if we already have auto-searched product context
            if (toolName === AppConfig.tools.productSearchName) {
              // Check if we already have auto-searched product context
              const hasAutoSearchedContext = conversationHistory.some(msg => {
                if (msg.role === 'user' && Array.isArray(msg.content)) {
                  return msg.content.some(block => 
                    block.type === 'text' && 
                    typeof block.text === 'string' && 
                    block.text.includes('[AUTO-SEARCHED PRODUCT CONTEXT]')
                  );
                }
                return false;
              });
              
              // If we have auto-searched context and this is a fitment question, skip the tool call
              // and use the existing context instead
              if (hasAutoSearchedContext && isFitmentQuestion) {
                console.log('Skipping redundant search - using auto-searched product context');
                // Add a tool result message indicating we're using existing context
                await toolService.addToolResultToHistory(
                  conversationHistory,
                  toolUseId,
                  { message: 'Using auto-searched product context - no additional search needed', skipSearch: true },
                  conversationId
                );
                // Return early without calling the tool
                // The AI should use the context that's already in the conversation
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
                conversationId
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
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.jsx:278',message:'Error caught in streamConversation',data:{errorMessage:error.message,errorStack:error.stack,errorStatus:error.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.jsx:282',message:'Error in handleChatSession catch',data:{errorMessage:error.message,errorStack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // The streaming handler takes care of error handling
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
    // Check if the customer account URL exists in the DB
    const existingUrls = await getCustomerAccountUrlsFromDb(conversationId);

    // If URL exists, return early with the MCP API URL
    if (existingUrls) return existingUrls;

    // If not, query for it from the Shopify API
    const { hostname } = new URL(shopDomain);

    const urls = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`).then(res => res.json()),
      fetch(`https://${hostname}/.well-known/openid-configuration`).then(res => res.json()),
    ]).then(async ([mcpResponse, openidResponse]) => {
      const response = {
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      };

      await storeCustomerAccountUrls({
        conversationId,
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      });

      return response;
    });

    return urls;
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

