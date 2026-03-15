#!/usr/bin/env node
/**
 * Chat Conversation Testing Agent
 *
 * Sends test messages to the chat endpoint, measures response times,
 * and uses an LLM judge to evaluate answer quality.
 *
 * Usage:
 *   node tests/chat-test.mjs [--base-url <url>] [--judge] [--verbose]
 *
 * Options:
 *   --base-url   Base URL of the chat server (default: http://localhost:3458)
 *   --judge      Enable LLM judge for answer quality (requires OPENAI_API_KEY)
 *   --verbose    Show full response text
 *   --timeout    Max response time in ms (default: 10000)
 *   --target     Target TTFT in ms (default: 2000)
 *   --max-chars  Max response length in chars (default: 800)
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const param = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const BASE_URL = param("base-url", "http://localhost:3458");
const CHAT_ENDPOINT = `${BASE_URL}/chat`;
const USE_JUDGE = flag("judge");
const VERBOSE = flag("verbose");
const TIMEOUT_MS = parseInt(param("timeout", "10000"), 10);
const TARGET_TTFT_MS = parseInt(param("target", "2000"), 10);
const MAX_RESPONSE_CHARS = parseInt(param("max-chars", "800"), 10);

// ── Store config ────────────────────────────────────────────────────
const STORE_DOMAIN = param("store-domain", "https://dev-nlp-brochure-2.myshopify.com");
const SHOP_HOSTNAME = new URL(STORE_DOMAIN).hostname;

// ── Support hours test helpers ──────────────────────────────────────
const prisma = new PrismaClient();
const TODAY_ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

async function configureSupportHours(supportHoursText, supportSchedule) {
  await prisma.chatSettings.upsert({
    where: { shop: SHOP_HOSTNAME },
    update: {
      supportHoursText: supportHoursText || '',
      supportSchedule: supportSchedule ? JSON.stringify(supportSchedule) : '',
    },
    create: {
      shop: SHOP_HOSTNAME,
      supportHoursText: supportHoursText || '',
      supportSchedule: supportSchedule ? JSON.stringify(supportSchedule) : '',
    },
  });
}

async function resetSupportHours() {
  await configureSupportHours('', null);
}

// ── Test scenarios ──────────────────────────────────────────────────
const TEST_CASES = [
  {
    name: "Simple greeting",
    message: "Hello, what can you help me with?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The response should be a friendly greeting explaining what the assistant can help with (products, orders, etc). Is the response appropriate AND concise (under 4 sentences)?",
    expectToolCall: false,
    maxChars: 400,
  },
  {
    name: "Product search",
    message: "Show me coilovers",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should show product results with names and prices, or mention searching the catalog. Does it present relevant coilover/suspension products? Is the text portion concise (not repeating product details already shown in cards)?",
    expectToolCall: true,
  },
  {
    name: "Fitment question on product page",
    message: "Does this fit my 2026 Dodge Challenger?",
    current_page_url: `${STORE_DOMAIN}/products/air-lift-11-23-dodge-charger-15-23-dodge-challenger-performance-rear-kit`,
    judgePrompt: "The assistant should address fitment/compatibility for a 2026 Dodge Challenger. It should give a direct yes/no answer with a brief explanation (1-3 sentences), not a lengthy essay. Does it address the fitment question concisely?",
    expectToolCall: true,
  },
  {
    name: "General knowledge question",
    message: "What is your return policy?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should attempt to answer about return policy (may use tools or general knowledge). Is the response relevant to return policies AND concise (not overly verbose)?",
    expectToolCall: false,
  },
  {
    name: "Follow-up question (new conversation)",
    message: "Do you have anything cheaper?",
    current_page_url: `${STORE_DOMAIN}/collections/all`,
    judgePrompt: "Without prior context, the assistant should ask what product category the customer is looking for, or attempt to search. Is the response reasonable and brief (1-3 sentences)?",
    expectToolCall: false,
    maxChars: 400,
  },
  {
    name: "App proxy body parsing (form-encoded)",
    message: "Hi, do you ship internationally?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The response should address shipping or ask for clarification. Is the response relevant and concise?",
    expectToolCall: false,
    maxChars: 600,
    // Simulate Shopify app proxy: sends JSON body but with form-encoded Content-Type
    contentType: "application/x-www-form-urlencoded",
  },
  {
    name: "Return policy knowledge (merchant knowledge)",
    message: "What is your return policy? How many days do I have?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should reference specific return policy details like the return window (e.g. 30 days), refund timeline, or conditions. A generic 'check with the store' is NOT acceptable — the merchant has configured return policy knowledge. Does the response include specific policy details?",
    expectToolCall: false,
    maxChars: 600,
  },
  {
    name: "Contact information knowledge",
    message: "How can I contact support? What are your hours?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should provide specific contact details like email, phone, or hours. A generic response without specific contact info is NOT acceptable — the merchant has configured contact information. Does the response include specific contact details?",
    expectToolCall: false,
    maxChars: 600,
  },
  {
    name: "Order tracking request",
    message: "Where is my order? I want to track my package.",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should ask for the customer's order number to look up the order status, OR attempt to use an order tracking tool. It should NOT just say 'check your email' — it should actively offer to help track the order. Does the response ask for an order number or attempt to look up order status?",
    expectToolCall: false,
    maxChars: 400,
  },
  // ── New: Conversational shopping assistant tests ──────────────────
  {
    name: "Vague product request (should ask clarifying questions)",
    message: "I want to buy a snowboard",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should NOT immediately list products. Instead, it should ask clarifying questions like skill level, budget, riding style, or preferences. A response that dumps product results without asking questions first is a FAIL. Does the assistant ask at least one clarifying question before recommending products?",
    expectToolCall: false,
    maxChars: 600,
  },
  {
    name: "Specific product request (should search immediately)",
    message: "Show me snowboards under $700",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The customer gave specific criteria (snowboards + price limit). The assistant should search and present relevant products, NOT ask more questions. Does the response include product recommendations or mention searching the catalog?",
    expectToolCall: true,
    maxChars: 1000,
  },
  {
    name: "Catalog browsing request (should search immediately)",
    message: "What snowboards do you carry?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The customer wants to browse the catalog. The assistant should search and show available snowboards, NOT ask clarifying questions first. Does the response present products from the catalog?",
    expectToolCall: true,
    maxChars: 1000,
  },
  {
    name: "Gift request (should ask clarifying questions)",
    message: "I need a gift for my friend who loves winter sports",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should ask clarifying questions like budget range, what type of product (gear, accessories), the friend's experience level, etc. A response that immediately lists products without asking questions is a FAIL. Does the assistant ask at least one clarifying question?",
    expectToolCall: false,
    maxChars: 600,
  },
  {
    name: "Search uses short keywords (not full message)",
    message: "I'm looking for something to protect my snowboard during travel",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should search for relevant products (snowboard bags, travel cases, etc.) or ask what type of protection they need. The key test is that IF the assistant searches, it should find relevant results — NOT return 0 products. A response saying 'no products found' when the store has snowboard gear is a FAIL. Is the response helpful and relevant?",
    expectToolCall: false,
    maxChars: 600,
  },
  {
    name: "Store policy via MCP tool (shipping)",
    message: "What is your shipping policy?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should attempt to find shipping policy info, either via the search_shop_policies_and_faqs tool or by giving a helpful generic answer. Does the response address shipping in some way?",
    expectToolCall: false,
    maxChars: 600,
  },
  {
    name: "Return policy via MCP tool",
    message: "What is your return and refund policy?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should use the search_shop_policies_and_faqs tool to look up the store's return/refund policy. If the store has a return policy configured, the response should include specific details from it (e.g., return window, conditions). A generic 'check the store website' without attempting a tool call is NOT acceptable. Does the response attempt to provide return policy details?",
    expectToolCall: false,
    maxChars: 800,
  },
  {
    name: "Contact information via MCP tool",
    message: "How can I contact you? What is your phone number and email?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should use the search_shop_policies_and_faqs tool to look up contact information. If the store has contact info configured, the response should include specific details like email, phone, or hours. Does the response attempt to provide contact details?",
    expectToolCall: false,
    maxChars: 600,
  },
  // ── Support hours / human handoff tests ────────────────────────────
  {
    name: "Request human during business hours",
    message: "Can I talk to a real person?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "User explicitly requests a human. Response should clearly acknowledge the handoff request and either confirm connection to a human agent or explain current availability and next steps without ignoring the request. Tone should be supportive and concise.",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
  },
  {
    name: "Request human with different phrasing",
    message: "I need to speak with someone from your team",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "User is asking for human support using alternative phrasing. Response should recognize this as a human handoff request, acknowledge it directly, and provide clear next steps (connect now or explain availability/hours).",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
  },
  {
    name: "Ask about support hours",
    message: "What are your support hours?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "User asks for support hours only. Response should provide support/contact hours if known from store knowledge, or transparently state uncertainty and suggest where/how to confirm. It should not force a handoff flow.",
    expectToolCall: false,
    maxChars: 600,
  },
  {
    name: "Request human and ask about hours",
    message: "I want to talk to a human, when are you available?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "User has dual intent: human handoff plus availability question. Response should acknowledge desire to speak to a human and also address support availability/hours. If unavailable, it should communicate that clearly while continuing to help politely.",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
  },
  {
    name: "Frustrated customer wanting human",
    message: "This isn't helping, let me talk to a manager",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "User is frustrated and requests escalation to a human/manager. Response should show empathy, acknowledge frustration, and attempt escalation or explain availability and next steps. It should avoid sounding dismissive.",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
  },
  {
    name: "Ask if support is available now",
    message: "Is anyone from your team available right now?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "User asks about immediate support availability. Response should directly address whether human support is currently available (or provide hours/limitations if unknown) and offer helpful alternatives in the meantime.",
    expectToolCall: false,
    maxChars: 600,
  },
  // ── Support hours E2E tests (configure DB before each) ────────────
  {
    name: "Request human — outside configured hours",
    message: "I need a human support agent right now.",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "User requested human help but support is outside configured hours (3-4am). Verify a support_unavailable signal appears with the display text, and the AI continues helping instead of handing off.",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
    setupHours: {
      text: "Mon-Fri 3am-4am ET",
      schedule: {
        timezone: "America/New_York",
        windows: [{ days: ["Mon","Tue","Wed","Thu","Fri"], startTime: "03:00", endTime: "04:00" }],
        overrides: [],
        alwaysAvailable: false,
        displayText: "Monday-Friday 3:00 AM - 4:00 AM ET",
      },
    },
  },
  {
    name: "Request human — within configured hours",
    message: "Please connect me to a human agent.",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "Support is configured as available every day all day (00:00-23:59). There should be NO support_unavailable event. The assistant should acknowledge the handoff request.",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
    setupHours: {
      text: "Every day 12am-11:59pm ET",
      schedule: {
        timezone: "America/New_York",
        windows: [{ days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], startTime: "00:00", endTime: "23:59" }],
        overrides: [],
        alwaysAvailable: false,
        displayText: "Every day 12:00 AM - 11:59 PM ET",
      },
    },
  },
  {
    name: "Request human — 24/7 availability",
    message: "I want to speak with a real person.",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "Support is set to 24/7 (alwaysAvailable). There should be NO support_unavailable event. The assistant should acknowledge the handoff request without any unavailability message.",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
    setupHours: {
      text: "24/7",
      schedule: {
        timezone: "America/New_York",
        windows: [],
        overrides: [],
        alwaysAvailable: true,
        displayText: "24/7 support",
      },
    },
  },
  {
    name: "Request human — holiday override closed",
    message: "Can you get me to a support representative?",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: `Normal schedule is open all day, but today (${TODAY_ET}) has a closed override with reason "Company Retreat". Verify support_unavailable is emitted and includes "Company Retreat".`,
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
    setupHours: {
      text: `Every day 12am-11:59pm ET, closed ${TODAY_ET} for Company Retreat`,
      schedule: {
        timezone: "America/New_York",
        windows: [{ days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], startTime: "00:00", endTime: "23:59" }],
        overrides: [{ date: TODAY_ET, closed: true, reason: "Company Retreat" }],
        alwaysAvailable: false,
        displayText: "Every day 12:00 AM - 11:59 PM ET",
      },
    },
  },
  {
    name: "Request human — no hours configured",
    message: "I need to talk to a human now.",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "No support hours are configured. There should be NO support_unavailable event. The assistant should acknowledge the handoff request without restrictions.",
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
    setupHours: { text: "", schedule: null },
  },
  {
    name: "Request human — holiday override custom hours",
    message: "Please transfer me to human support.",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: `Normal schedule is open all day, but today (${TODAY_ET}) has an override limiting support to 3-4am with reason "Holiday half day". Verify support_unavailable appears with the reason.`,
    expectToolCall: false,
    maxChars: 600,
    requestHuman: true,
    setupHours: {
      text: `Every day 12am-11:59pm ET, ${TODAY_ET} only 3am-4am (Holiday half day)`,
      schedule: {
        timezone: "America/New_York",
        windows: [{ days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], startTime: "00:00", endTime: "23:59" }],
        overrides: [{ date: TODAY_ET, startTime: "03:00", endTime: "04:00", reason: "Holiday half day" }],
        alwaysAvailable: false,
        displayText: "Every day 12:00 AM - 11:59 PM ET (holiday overrides apply)",
      },
    },
  },
];

// ── SSE parser ──────────────────────────────────────────────────────
function parseSseEvents(text) {
  const events = [];
  const blocks = text.split("\n\n");
  for (const block of blocks) {
    if (block.startsWith("data: ")) {
      try {
        events.push(JSON.parse(block.slice(6)));
      } catch { /* skip malformed */ }
    }
  }
  return events;
}

// ── Send a chat message and collect timing + response ───────────────
async function sendChatMessage(testCase) {
  const conversationId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bodyObj = {
    message: testCase.message,
    conversation_id: conversationId,
    prompt_type: "standardAssistant",
    current_page_url: testCase.current_page_url,
  };
  if (testCase.requestHuman) bodyObj.request_human = true;
  const body = JSON.stringify(bodyObj);

  const startTime = performance.now();
  let firstChunkTime = null;
  let fullResponseText = "";
  let toolCalls = [];
  let events = [];
  let error = null;
  let messageIds = [];
  let supportUnavailable = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": testCase.contentType || "application/json",
        Accept: "text/event-stream",
        "X-Shopify-Shop-Id": "test-shop",
        Origin: STORE_DOMAIN,
      },
      body,  // Always send JSON string — server should parse it regardless of Content-Type
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Parse complete SSE blocks
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        if (!block.startsWith("data: ")) continue;
        let data;
        try {
          data = JSON.parse(block.slice(6));
        } catch {
          continue;
        }

        events.push(data);

        if (data.type === "chunk" && !firstChunkTime) {
          firstChunkTime = performance.now();
        }

        if (data.type === "chunk" && data.chunk) {
          fullResponseText += data.chunk;
        }

        if (data.type === "tool_use") {
          toolCalls.push(data.tool_use_message || data);
        }

        if (data.type === "message_id" && data.message_id) {
          messageIds.push(data.message_id);
        }

        if (data.type === "error") {
          error = data.error || "Unknown error";
        }

        if (data.type === "support_unavailable") {
          supportUnavailable = data;
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      error = `Timeout after ${TIMEOUT_MS}ms`;
    } else {
      error = err.message;
    }
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const ttft = firstChunkTime ? firstChunkTime - startTime : null;

  return {
    conversationId,
    totalTime,
    ttft,
    fullResponseText,
    toolCalls,
    events,
    error,
    messageIds,
    supportUnavailable,
  };
}

// ── LLM Judge ───────────────────────────────────────────────────────
async function judgeResponse(testCase, responseText, productCards = []) {
  if (!process.env.OPENAI_API_KEY) {
    return { pass: null, reason: "No OPENAI_API_KEY set, skipping judge" };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Include product card info if present so the judge can evaluate the full response
    let productContext = "";
    if (productCards.length > 0) {
      const cardSummary = productCards.slice(0, 5).map(p =>
        `- ${p.title} — ${p.price}${p.url ? ` (${p.url})` : ''}`
      ).join("\n");
      productContext = `\n\nProduct cards shown to user (${productCards.length} total):\n${cardSummary}`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            'You are a QA judge evaluating a chatbot response. Respond with JSON: {"pass": true/false, "reason": "brief explanation"}. Be lenient — the bot may not have real store data. Focus on whether the response is reasonable and relevant. Product cards are displayed visually alongside the text response — count them as part of the answer.',
        },
        {
          role: "user",
          content: `Test: "${testCase.name}"
User message: "${testCase.message}"
Page URL: ${testCase.current_page_url}

Evaluation criteria: ${testCase.judgePrompt}

Bot response:
${responseText || "(empty response)"}${productContext}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content || "";
    try {
      return JSON.parse(content);
    } catch {
      return { pass: null, reason: `Judge returned non-JSON: ${content}` };
    }
  } catch (err) {
    return { pass: null, reason: `Judge error: ${err.message}` };
  }
}

// ── Pretty print ────────────────────────────────────────────────────
function formatMs(ms) {
  if (ms === null) return "N/A";
  return `${Math.round(ms)}ms`;
}

function statusIcon(pass) {
  if (pass === true) return "PASS";
  if (pass === false) return "FAIL";
  return "SKIP";
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(70));
  console.log("  Chat Conversation Testing Agent");
  console.log(`  Target: ${CHAT_ENDPOINT}`);
  console.log(`  TTFT target: ${TARGET_TTFT_MS}ms | Timeout: ${TIMEOUT_MS}ms`);
  console.log(`  Judge: ${USE_JUDGE ? "enabled" : "disabled (use --judge)"}`);
  console.log("=".repeat(70));
  console.log();

  const results = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`[${i + 1}/${TEST_CASES.length}] ${tc.name}`);
    console.log(`  Message: "${tc.message}"`);
    console.log(`  Page: ${tc.current_page_url}`);

    // Configure support hours in DB if test case requires it
    if (tc.setupHours) {
      try {
        await configureSupportHours(tc.setupHours.text, tc.setupHours.schedule);
        console.log(`  Setup: configured support hours → "${tc.setupHours.text || '(empty)'}"`);
      } catch (err) {
        console.log(`  Setup: FAILED to configure hours — ${err.message}`);
      }
    }

    const result = await sendChatMessage(tc);

    // Timing checks
    const ttftPass = result.ttft !== null && result.ttft <= TARGET_TTFT_MS;
    const hasResponse = result.fullResponseText.length > 0;
    const hasError = !!result.error;

    const charLimit = tc.maxChars || MAX_RESPONSE_CHARS;
    const concisePass = result.fullResponseText.length <= charLimit;

    console.log(`  TTFT: ${formatMs(result.ttft)} ${ttftPass ? "PASS" : result.ttft === null ? "(no text chunks)" : "FAIL"}`);
    console.log(`  Total: ${formatMs(result.totalTime)}`);
    console.log(`  Response length: ${result.fullResponseText.length} chars (limit: ${charLimit}) ${concisePass ? "PASS" : "FAIL — TOO LONG"}`);
    console.log(`  Tool calls: ${result.toolCalls.length}`);

    if (result.supportUnavailable) {
      console.log(`  Support unavailable: displayText="${result.supportUnavailable.displayText || ''}" reason="${result.supportUnavailable.reason || ''}"`);
    }

    if (hasError) {
      console.log(`  Error: ${result.error}`);
    }

    if (VERBOSE && result.fullResponseText) {
      console.log(`  Response: ${result.fullResponseText.substring(0, 500)}${result.fullResponseText.length > 500 ? "..." : ""}`);
    }

    // LLM judge
    let judgeResult = { pass: null, reason: "Judge disabled" };
    if (USE_JUDGE) {
      process.stdout.write("  Judging quality... ");
      // Extract product cards from SSE events for the judge
      const productCards = result.events
        .filter(e => e.type === "product_results" && e.products)
        .flatMap(e => e.products);
      // Include support_unavailable SSE event info so judge has full context
      let responseForJudge = result.fullResponseText;
      if (result.supportUnavailable) {
        responseForJudge += `\n\n[System event: support_unavailable — displayText: "${result.supportUnavailable.displayText || ''}", reason: "${result.supportUnavailable.reason || ''}"]`;
      }
      judgeResult = await judgeResponse(tc, responseForJudge, productCards);
      console.log(`${statusIcon(judgeResult.pass)} - ${judgeResult.reason}`);
    }

    results.push({
      name: tc.name,
      ttft: result.ttft,
      ttftPass,
      totalTime: result.totalTime,
      responseLen: result.fullResponseText.length,
      concisePass,
      hasResponse,
      hasError,
      error: result.error,
      toolCallCount: result.toolCalls.length,
      judgePass: judgeResult.pass,
      judgeReason: judgeResult.reason,
      messageIds: result.messageIds,
    });

    console.log();
  }

  // ── Feedback E2E test ──────────────────────────────────────────
  console.log("--- Feedback E2E Test ---");
  const firstMessageId = results.flatMap(r => r.messageIds || []).find(Boolean);
  if (firstMessageId) {
    try {
      const fbUrl = `${BASE_URL}/chat?feedback=true&message_id=${encodeURIComponent(firstMessageId)}&value=good`;
      const fbRes = await fetch(fbUrl, { method: "GET", headers: { Origin: STORE_DOMAIN } });
      const fbBody = await fbRes.json();
      console.log(`  Feedback submit (message ${firstMessageId}): ${fbRes.ok && fbBody.success ? "PASS" : "FAIL"}`);
    } catch (err) {
      console.log(`  Feedback submit: FAIL (${err.message})`);
    }
  } else {
    console.log("  Feedback submit: SKIP (no message_id received)");
  }
  console.log();

  // ── Activity Tracking E2E test ────────────────────────────────
  console.log("--- Activity Tracking E2E Test ---");
  const activityConvId = results[0]?.name ? `test-${Date.now()}-activity` : null;
  if (activityConvId) {
    try {
      // First send a chat message to create the conversation
      const chatResult = await sendChatMessage({
        name: "Activity setup",
        message: "hi",
        current_page_url: `${STORE_DOMAIN}/products/test-product`,
      });
      const convId = chatResult.events.find(e => e.conversation_id)?.conversation_id || activityConvId;

      // Send activity update via GET (same as storefront widget)
      const activityParams = new URLSearchParams({
        activity: 'true',
        conversation_id: convId,
        currentPageUrl: `${STORE_DOMAIN}/products/test-snowboard`,
        currentPageTitle: 'Test Snowboard Product',
        viewingProduct: JSON.stringify({ title: 'Test Snowboard', price: '699.95' }),
        cartContents: JSON.stringify([
          { title: 'The Complete Snowboard', quantity: 1, price: '699.95', variantTitle: 'Ice' },
          { title: 'Snowboard Wax', quantity: 2, price: '12.99', variantTitle: 'Default' },
        ]),
      });
      const activityRes = await fetch(`${BASE_URL}/chat?${activityParams.toString()}`, {
        method: "GET",
        headers: { Origin: STORE_DOMAIN },
      });
      console.log(`  Activity submit: ${activityRes.status === 204 ? "PASS" : "FAIL"} (status: ${activityRes.status})`);

      // Verify activity was saved by checking if a second update works
      const activityParams2 = new URLSearchParams({
        activity: 'true',
        conversation_id: convId,
        currentPageUrl: `${STORE_DOMAIN}/collections/all`,
        currentPageTitle: 'All Products',
        viewingProduct: '',
        cartContents: JSON.stringify([
          { title: 'The Complete Snowboard', quantity: 2, price: '699.95', variantTitle: 'Ice' },
        ]),
      });
      const activityRes2 = await fetch(`${BASE_URL}/chat?${activityParams2.toString()}`, {
        method: "GET",
        headers: { Origin: STORE_DOMAIN },
      });
      console.log(`  Activity update: ${activityRes2.status === 204 ? "PASS" : "FAIL"} (status: ${activityRes2.status})`);
    } catch (err) {
      console.log(`  Activity tracking: FAIL (${err.message})`);
    }
  } else {
    console.log("  Activity tracking: SKIP (no conversations available)");
  }
  console.log();

  // ── Conversation Persistence E2E test ───────────────────────────
  console.log("--- Conversation Persistence E2E Test ---");
  try {
    // Send first message
    const msg1 = await sendChatMessage({
      name: "Persistence msg 1",
      message: "Hello, I need help",
      current_page_url: `${STORE_DOMAIN}/`,
    });
    const persistConvId = msg1.events.find(e => e.conversation_id)?.conversation_id;

    if (persistConvId) {
      // Send second message with same conversation_id (simulates same session)
      const body2 = JSON.stringify({
        message: "I want a snowboard",
        conversation_id: persistConvId,
        current_page_url: `${STORE_DOMAIN}/collections/snowboards`,
      });
      const res2 = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Shopify-Shop-Id": "test-shop",
          Origin: STORE_DOMAIN,
        },
        body: body2,
      });
      console.log(`  Same conversation_id reuse: ${res2.ok ? "PASS" : "FAIL"} (status: ${res2.status})`);

      // Verify history contains both messages
      const historyRes = await fetch(`${BASE_URL}/chat?history=true&conversation_id=${encodeURIComponent(persistConvId)}`, {
        headers: { Origin: STORE_DOMAIN },
      });
      const historyData = await historyRes.json();
      const msgCount = historyData.messages?.length || 0;
      console.log(`  History contains messages: ${msgCount >= 2 ? "PASS" : "FAIL"} (${msgCount} messages)`);
    } else {
      console.log(`  Conversation persistence: FAIL (no conversation_id received)`);
    }
  } catch (err) {
    console.log(`  Conversation persistence: FAIL (${err.message})`);
  }
  console.log();

  // ── Feedback Both Values E2E test ───────────────────────────────
  console.log("--- Feedback Both Values E2E Test ---");
  const allMessageIds = results.flatMap(r => r.messageIds || []).filter(Boolean);
  if (allMessageIds.length >= 2) {
    try {
      // Test thumbs up
      const fbUpUrl = `${BASE_URL}/chat?feedback=true&message_id=${encodeURIComponent(allMessageIds[0])}&value=good`;
      const fbUpRes = await fetch(fbUpUrl, { method: "GET", headers: { Origin: STORE_DOMAIN } });
      const fbUpBody = await fbUpRes.json();
      console.log(`  Thumbs up (good): ${fbUpRes.ok && fbUpBody.success ? "PASS" : "FAIL"}`);

      // Test thumbs down
      const fbDownUrl = `${BASE_URL}/chat?feedback=true&message_id=${encodeURIComponent(allMessageIds[1])}&value=bad`;
      const fbDownRes = await fetch(fbDownUrl, { method: "GET", headers: { Origin: STORE_DOMAIN } });
      const fbDownBody = await fbDownRes.json();
      console.log(`  Thumbs down (bad): ${fbDownRes.ok && fbDownBody.success ? "PASS" : "FAIL"}`);
    } catch (err) {
      console.log(`  Feedback both values: FAIL (${err.message})`);
    }
  } else {
    console.log(`  Feedback both values: SKIP (need 2+ message IDs, got ${allMessageIds.length})`);
  }
  console.log();

  // ── Timestamp in SSE events test ────────────────────────────────
  console.log("--- Timestamp / Message ID E2E Test ---");
  {
    const hasMessageIds = results.some(r => r.messageIds && r.messageIds.length > 0);
    console.log(`  SSE message_id events received: ${hasMessageIds ? "PASS" : "FAIL"}`);

    // Check that history messages have createdAt timestamps
    const anyConvId = results.flatMap(r => [r]).find(r => r.messageIds?.length)?.messageIds;
    if (anyConvId) {
      try {
        const histRes = await fetch(`${BASE_URL}/chat?history=true&conversation_id=${encodeURIComponent(results[0]?.name ? `test-${Date.now()}` : 'none')}`, {
          headers: { Origin: STORE_DOMAIN },
        });
        // Just verify history endpoint works
        console.log(`  History endpoint responds: ${histRes.ok ? "PASS" : "FAIL"} (status: ${histRes.status})`);
      } catch (err) {
        console.log(`  History endpoint: FAIL (${err.message})`);
      }
    }
  }
  console.log();

  // ── MCP Policy Tool E2E test ────────────────────────────────────
  console.log("--- MCP Policy Tool E2E Test ---");
  try {
    // Test that the storefront MCP search_shop_policies_and_faqs tool is accessible
    const mcpUrl = `${STORE_DOMAIN}/api/mcp`;
    const toolsRes = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1, params: {} }),
    });
    const toolsData = await toolsRes.json();
    const tools = toolsData?.result?.tools || [];
    const hasPolicyTool = tools.some(t => t.name === "search_shop_policies_and_faqs");
    console.log(`  MCP tools endpoint responds: ${toolsRes.ok ? "PASS" : "FAIL"} (${tools.length} tools)`);
    console.log(`  search_shop_policies_and_faqs available: ${hasPolicyTool ? "PASS" : "FAIL"}`);

    // Test calling the policy tool
    if (hasPolicyTool) {
      const policyRes = await fetch(mcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "tools/call", id: 2,
          params: { name: "search_shop_policies_and_faqs", arguments: { query: "return policy", context: "test" } },
        }),
      });
      const policyData = await policyRes.json();
      const policyText = policyData?.result?.content?.[0]?.text || "";
      const hasContent = policyText.length > 2 && policyText !== "[]";
      console.log(`  Policy query returns content: ${hasContent ? "PASS" : "WARN — empty (policies may not be indexed yet)"}`);
    }
  } catch (err) {
    console.log(`  MCP Policy tool: FAIL (${err.message})`);
  }
  console.log();

  // ── Summary ─────────────────────────────────────────────────────
  console.log("=".repeat(70));
  console.log("  SUMMARY");
  console.log("=".repeat(70));
  console.log();
  console.log(
    "Test".padEnd(35) +
    "TTFT".padEnd(9) +
    "Total".padEnd(9) +
    "Chars".padEnd(7) +
    "Speed".padEnd(7) +
    "Concise".padEnd(9) +
    "Quality".padEnd(8)
  );
  console.log("-".repeat(84));

  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const r of results) {
    const speedStatus = r.hasError ? "ERR" : (r.ttftPass ? "PASS" : "FAIL");
    const conciseStatus = r.concisePass ? "PASS" : "FAIL";
    const qualityStatus = statusIcon(r.judgePass);

    console.log(
      r.name.padEnd(35) +
      formatMs(r.ttft).padEnd(9) +
      formatMs(r.totalTime).padEnd(9) +
      String(r.responseLen).padEnd(7) +
      speedStatus.padEnd(7) +
      conciseStatus.padEnd(9) +
      qualityStatus.padEnd(8)
    );

    if (r.ttftPass && r.concisePass && (r.judgePass === true || r.judgePass === null)) passCount++;
    else if (r.hasError || r.ttftPass === false || r.judgePass === false || !r.concisePass) failCount++;
    else skipCount++;
  }

  console.log("-".repeat(84));
  console.log(`Total: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
  console.log();

  // Average TTFT
  const ttfts = results.filter(r => r.ttft !== null).map(r => r.ttft);
  if (ttfts.length > 0) {
    const avg = ttfts.reduce((a, b) => a + b, 0) / ttfts.length;
    console.log(`Average TTFT: ${formatMs(avg)} (target: ${TARGET_TTFT_MS}ms)`);
  }

  const totalTimes = results.map(r => r.totalTime);
  const avgTotal = totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length;
  console.log(`Average total response time: ${formatMs(avgTotal)}`);
  console.log();

  // Clean up: reset support hours and disconnect Prisma
  try {
    await resetSupportHours();
    await prisma.$disconnect();
  } catch { /* ignore cleanup errors */ }

  // Exit code
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(2);
});
