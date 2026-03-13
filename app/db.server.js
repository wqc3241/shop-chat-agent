import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;

/**
 * Store a code verifier for PKCE authentication
 * @param {string} state - The state parameter used in OAuth flow
 * @param {string} verifier - The code verifier to store
 * @returns {Promise<Object>} - The saved code verifier object
 */
export async function storeCodeVerifier(state, verifier) {
  // Calculate expiration date (10 minutes from now)
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

  try {
    return await prisma.codeVerifier.create({
      data: {
        id: `cv_${Date.now()}`,
        state,
        verifier,
        expiresAt
      }
    });
  } catch (error) {
    console.error('Error storing code verifier:', error);
    throw error;
  }
}

/**
 * Get a code verifier by state parameter
 * @param {string} state - The state parameter used in OAuth flow
 * @returns {Promise<Object|null>} - The code verifier object or null if not found
 */
export async function getCodeVerifier(state) {
  try {
    const verifier = await prisma.codeVerifier.findFirst({
      where: {
        state,
        expiresAt: {
          gt: new Date()
        }
      }
    });

    if (verifier) {
      // Delete it after retrieval to prevent reuse
      await prisma.codeVerifier.delete({
        where: {
          id: verifier.id
        }
      });
    }

    return verifier;
  } catch (error) {
    console.error('Error retrieving code verifier:', error);
    return null;
  }
}

/**
 * Store a customer access token in the database
 * @param {string} conversationId - The conversation ID to associate with the token
 * @param {string} accessToken - The access token to store
 * @param {Date} expiresAt - When the token expires
 * @returns {Promise<Object>} - The saved customer token
 */
export async function storeCustomerToken(conversationId, accessToken, expiresAt) {
  try {
    // Check if a token already exists for this conversation
    const existingToken = await prisma.customerToken.findFirst({
      where: { conversationId }
    });

    if (existingToken) {
      // Update existing token
      return await prisma.customerToken.update({
        where: { id: existingToken.id },
        data: {
          accessToken,
          expiresAt,
          updatedAt: new Date()
        }
      });
    }

    // Create a new token record
    return await prisma.customerToken.create({
      data: {
        id: `ct_${Date.now()}`,
        conversationId,
        accessToken,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error storing customer token:', error);
    throw error;
  }
}

/**
 * Get a customer access token by conversation ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>} - The customer token or null if not found/expired
 */
export async function getCustomerToken(conversationId) {
  try {
    const token = await prisma.customerToken.findFirst({
      where: {
        conversationId,
        expiresAt: {
          gt: new Date() // Only return non-expired tokens
        }
      }
    });

    return token;
  } catch (error) {
    console.error('Error retrieving customer token:', error);
    return null;
  }
}

/**
 * Create or update a conversation in the database
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} - The created or updated conversation
 */
export async function createOrUpdateConversation(conversationId) {
  try {
    const existingConversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (existingConversation) {
      return await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date()
        }
      });
    }

    return await prisma.conversation.create({
      data: {
        id: conversationId
      }
    });
  } catch (error) {
    console.error('Error creating/updating conversation:', error);
    throw error;
  }
}

/**
 * Save a message to the database
 * @param {string} conversationId - The conversation ID
 * @param {string} role - The message role (user or assistant)
 * @param {string} content - The message content
 * @returns {Promise<Object>} - The saved message
 */
export async function saveMessage(conversationId, role, content) {
  try {
    // Ensure the conversation exists
    await createOrUpdateConversation(conversationId);

    // Create the message
    return await prisma.message.create({
      data: {
        conversationId,
        role,
        content
      }
    });
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

/**
 * Get conversation history
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Array>} - Array of messages in the conversation
 */
export async function getConversationHistory(conversationId) {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' }
    });

    return messages;
  } catch (error) {
    console.error('Error retrieving conversation history:', error);
    return [];
  }
}

/**
 * Store customer account URLs for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {string} mcpApiUrl - The customer account MCP URL
 * @param {string} authorizationUrl - The customer account authorization URL
 * @param {string} tokenUrl - The customer account token URL
 * @returns {Promise<Object>} - The saved urls object
 */
export async function storeCustomerAccountUrls({conversationId, mcpApiUrl, authorizationUrl, tokenUrl}) {
  try {
    return await prisma.customerAccountUrls.upsert({
      where: { conversationId },
      create: {
        conversationId,
        mcpApiUrl,
        authorizationUrl,
        tokenUrl,
        updatedAt: new Date(),
      },
      update: {
        mcpApiUrl,
        authorizationUrl,
        tokenUrl,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error storing customer account URLs:', error);
    throw error;
  }
}

/**
 * Get customer account URLs for a conversation
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>} - The customer account URLs or null if not found
 */
export async function getCustomerAccountUrls(conversationId) {
  try {
    return await prisma.customerAccountUrls.findUnique({
      where: { conversationId }
    });
  } catch (error) {
    console.error('Error retrieving customer account URLs:', error);
    return null;
  }
}

// ── Live chat (merchant handoff) functions ───────────────────────────

/**
 * Get a conversation without messages (for mode checks)
 * @param {string} id - The conversation ID
 * @returns {Promise<Object|null>} The conversation or null
 */
export async function getConversation(id) {
  try {
    return await prisma.conversation.findUnique({ where: { id } });
  } catch (error) {
    console.error('Error getting conversation:', error);
    return null;
  }
}

/**
 * Get messages created after a given timestamp
 * @param {string} conversationId - The conversation ID
 * @param {Date|string} sinceDate - Only return messages after this date
 * @returns {Promise<Array>} Array of messages
 */
export async function getMessagesSince(conversationId, sinceDate) {
  try {
    return await prisma.message.findMany({
      where: {
        conversationId,
        createdAt: { gt: new Date(sinceDate) },
      },
      orderBy: { createdAt: 'asc' },
    });
  } catch (error) {
    console.error('Error getting messages since:', error);
    return [];
  }
}

/**
 * Update conversation fields (mode, assignedTo, handoffAt, etc.)
 * @param {string} id - The conversation ID
 * @param {Object} data - Fields to update
 * @returns {Promise<Object|null>} The updated conversation or null
 */
export async function updateConversation(id, data) {
  try {
    return await prisma.conversation.update({ where: { id }, data });
  } catch (error) {
    console.error('Error updating conversation:', error);
    return null;
  }
}

/**
 * Get active conversations for a shop (last 24h) with last message preview
 * @param {string} shop - The shop domain
 * @returns {Promise<Array>} Array of conversations with previews
 */
export async function getActiveConversations(shop) {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const conversations = await prisma.conversation.findMany({
      where: {
        shop,
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
      },
    });
    return conversations;
  } catch (error) {
    console.error('Error getting active conversations:', error);
    return [];
  }
}

/**
 * Attempt optimistic takeover — only succeeds if no one else has taken it
 * @param {string} id - The conversation ID
 * @param {string} merchantId - The merchant staff identifier
 * @returns {Promise<{conversation?: Object, error?: string}>} Result with conversation or error
 */
export async function takeOverConversation(id, merchantId) {
  try {
    // Optimistic lock: only take over if assignedTo is null
    const result = await prisma.conversation.updateMany({
      where: { id, assignedTo: null },
      data: {
        mode: 'merchant',
        assignedTo: merchantId,
        handoffAt: new Date(),
      },
    });
    if (result.count === 0) {
      // Check why it failed — is someone else assigned, or does it not exist?
      const existing = await prisma.conversation.findUnique({ where: { id } });
      if (!existing) return { error: 'not_found' };
      if (existing.assignedTo) return { error: 'already_taken', assignedTo: existing.assignedTo };
      return { error: 'already_taken' };
    }
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    return { conversation };
  } catch (error) {
    console.error('Error taking over conversation:', error);
    return { error: 'db_error', message: error.message };
  }
}

/**
 * Resolve a conversation — sets it back to AI mode and marks it as resolved
 * @param {string} id - The conversation ID
 * @returns {Promise<Object|null>} The updated conversation or null
 */
export async function resolveConversation(id) {
  try {
    return await prisma.conversation.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        mode: 'ai',
        assignedTo: null,
        handoffAt: null,
      },
    });
  } catch (error) {
    console.error('Error resolving conversation:', error);
    return null;
  }
}

/**
 * Release a conversation back to AI
 * @param {string} id - The conversation ID
 * @returns {Promise<Object|null>} Updated conversation
 */
export async function releaseConversation(id) {
  try {
    return await prisma.conversation.update({
      where: { id },
      data: {
        mode: 'ai',
        assignedTo: null,
        handoffAt: null,
      },
    });
  } catch (error) {
    console.error('Error releasing conversation:', error);
    return null;
  }
}

// ── Dashboard functions ──────────────────────────────────────────────

/**
 * Get or create chat settings for a shop
 * @param {string} shop - The shop domain
 * @returns {Promise<Object>} The chat settings
 */
export async function getChatSettings(shop) {
  try {
    let settings = await prisma.chatSettings.findUnique({ where: { shop } });
    if (!settings) {
      settings = await prisma.chatSettings.create({ data: { shop } });
    }
    return settings;
  } catch (error) {
    console.error('Error getting chat settings:', error);
    return null;
  }
}

/**
 * Save chat settings for a shop
 * @param {string} shop - The shop domain
 * @param {Object} data - The settings to save
 * @returns {Promise<Object>} The updated settings
 */
export async function saveChatSettings(shop, data) {
  try {
    return await prisma.chatSettings.upsert({
      where: { shop },
      create: { shop, ...data },
      update: data,
    });
  } catch (error) {
    console.error('Error saving chat settings:', error);
    throw error;
  }
}

/**
 * Get conversations for a shop with message counts
 * @param {string} shop - The shop domain
 * @param {number} limit - Max conversations to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Object>} Conversations and total count
 */
export async function getConversationsForShop(shop, limit = 25, offset = 0) {
  try {
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { shop },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { _count: { select: { messages: true } } },
      }),
      prisma.conversation.count({ where: { shop } }),
    ]);
    return { conversations, total };
  } catch (error) {
    console.error('Error getting conversations:', error);
    return { conversations: [], total: 0 };
  }
}

/**
 * Get a conversation with all its messages
 * @param {string} id - The conversation ID
 * @returns {Promise<Object|null>} The conversation with messages
 */
export async function getConversationWithMessages(id) {
  try {
    return await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
  } catch (error) {
    console.error('Error getting conversation with messages:', error);
    return null;
  }
}

/**
 * Append an order number to a conversation's orderNumbers field
 * @param {string} conversationId - The conversation ID
 * @param {string} orderNumber - The order number to add
 */
export async function updateConversationOrders(conversationId, orderNumber) {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { orderNumbers: true },
    });
    if (!conversation) return;

    const existing = conversation.orderNumbers
      ? conversation.orderNumbers.split(',').map(s => s.trim())
      : [];
    if (existing.includes(orderNumber)) return;
    existing.push(orderNumber);

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { orderNumbers: existing.join(', ') },
    });
  } catch (error) {
    console.error('Error updating conversation orders:', error);
  }
}

/**
 * Update conversation metadata (shop, pageUrl, customerEmail)
 * @param {string} conversationId - The conversation ID
 * @param {Object} data - Metadata fields to update
 */
export async function updateConversationMeta(conversationId, data) {
  try {
    await prisma.conversation.update({
      where: { id: conversationId },
      data,
    });
  } catch (error) {
    console.error('Error updating conversation meta:', error);
  }
}

/**
 * Update feedback on a message
 * @param {string} messageId - The message ID
 * @param {string} feedback - "good" | "bad"
 */
export async function updateMessageFeedback(messageId, feedback) {
  return prisma.message.update({
    where: { id: messageId },
    data: { feedback },
  });
}

/**
 * Upsert customer activity for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {Object} data - Activity data
 */
export async function upsertCustomerActivity(conversationId, data) {
  return prisma.customerActivity.upsert({
    where: { conversationId },
    update: { ...data, updatedAt: new Date() },
    create: {
      conversationId,
      ...data,
      updatedAt: new Date(),
    },
  });
}

/**
 * Get customer activity for a conversation
 * @param {string} conversationId - The conversation ID
 */
export async function getCustomerActivity(conversationId) {
  return prisma.customerActivity.findUnique({
    where: { conversationId },
  });
}

/**
 * Get dashboard metrics for a shop
 * @param {string} shop - The shop domain
 * @returns {Promise<Object>} Metrics object
 */
export async function getDashboardMetrics(shop) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, today, withOrders] = await Promise.all([
      prisma.conversation.count({ where: { shop } }),
      prisma.conversation.count({ where: { shop, createdAt: { gte: todayStart } } }),
      prisma.conversation.count({ where: { shop, orderNumbers: { not: null } } }),
    ]);

    return { total, today, withOrders };
  } catch (error) {
    console.error('Error getting dashboard metrics:', error);
    return { total: 0, today: 0, withOrders: 0 };
  }
}
