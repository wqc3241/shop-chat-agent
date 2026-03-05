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
const STORE_DOMAIN = "https://dev-nlp-brochure.myshopify.com";

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
    message: "Show me brake pads",
    current_page_url: `${STORE_DOMAIN}/`,
    judgePrompt: "The assistant should either show product results or mention searching the catalog. Does it attempt to help find brake pads? Is the text portion concise (not repeating product details already shown in cards)?",
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
  const body = JSON.stringify({
    message: testCase.message,
    conversation_id: conversationId,
    prompt_type: "standardAssistant",
    current_page_url: testCase.current_page_url,
  });

  const startTime = performance.now();
  let firstChunkTime = null;
  let fullResponseText = "";
  let toolCalls = [];
  let events = [];
  let error = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Shopify-Shop-Id": "test-shop",
        Origin: STORE_DOMAIN,
      },
      body,
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

        if (data.type === "error") {
          error = data.error || "Unknown error";
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
  };
}

// ── LLM Judge ───────────────────────────────────────────────────────
async function judgeResponse(testCase, responseText) {
  if (!process.env.OPENAI_API_KEY) {
    return { pass: null, reason: "No OPENAI_API_KEY set, skipping judge" };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            'You are a QA judge evaluating a chatbot response. Respond with JSON: {"pass": true/false, "reason": "brief explanation"}. Be lenient — the bot may not have real store data. Focus on whether the response is reasonable and relevant.',
        },
        {
          role: "user",
          content: `Test: "${testCase.name}"
User message: "${testCase.message}"
Page URL: ${testCase.current_page_url}

Evaluation criteria: ${testCase.judgePrompt}

Bot response:
${responseText || "(empty response)"}`,
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
      judgeResult = await judgeResponse(tc, result.fullResponseText);
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
    });

    console.log();
  }

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

  // Exit code
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
