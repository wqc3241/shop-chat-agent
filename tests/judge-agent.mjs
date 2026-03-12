#!/usr/bin/env node
/**
 * Comprehensive Customer Judge Agent
 *
 * Simulates a real customer having multi-turn conversations with the chatbot.
 * Tests product search, fitment questions, general store questions, purchasing,
 * and natural language flow. Uses an LLM judge to evaluate each response.
 *
 * Usage:
 *   node tests/judge-agent.mjs [--base-url <url>] [--verbose] [--scenario <name>]
 *
 * Options:
 *   --base-url   Base URL (default: auto-detect from dev server)
 *   --verbose    Show full response text and SSE events
 *   --scenario   Run a specific scenario by name
 *   --timeout    Max response time in ms (default: 30000)
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const param = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const VERBOSE = flag("verbose");
const SCENARIO_FILTER = param("scenario", null);
const TIMEOUT_MS = parseInt(param("timeout", "30000"), 10);
const STORE_DOMAIN = "https://dev-nlp-brochure.myshopify.com";

// Auto-detect base URL from running dev server
function detectBaseUrl() {
  const override = param("base-url", null);
  if (override) return override;

  try {
    // Find the Vite dev server port from netstat
    const output = execSync('netstat -ano | findstr LISTENING | findstr /R ":\\<[0-9]*\\>"', { encoding: 'utf8', timeout: 5000 });
    // We know port 3457 is GraphiQL. Look for the Vite port by testing common ranges.
    const ports = [...output.matchAll(/:(\d+)\s/g)].map(m => parseInt(m[1]));
    // Filter for likely Vite ports (high port range, not 3457/9293)
    const candidates = [...new Set(ports)].filter(p => p > 50000 && p < 65000).sort();
    for (const port of candidates) {
      try {
        execSync(`curl -s --max-time 2 http://localhost:${port}/health`, { encoding: 'utf8', timeout: 3000 });
        return `http://localhost:${port}`;
      } catch { /* not this one */ }
    }
  } catch { /* fallback */ }

  return "http://localhost:57441";
}

const BASE_URL = detectBaseUrl();
const CHAT_ENDPOINT = `${BASE_URL}/chat`;

// ── SSE client ──────────────────────────────────────────────────────
async function sendMessage(conversationId, message, pageUrl) {
  const body = JSON.stringify({
    message,
    conversation_id: conversationId,
    prompt_type: "standardAssistant",
    current_page_url: pageUrl || `${STORE_DOMAIN}/`,
  });

  const startTime = performance.now();
  let firstChunkTime = null;
  let fullText = "";
  let toolCalls = [];
  let productResults = [];
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
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        if (!block.startsWith("data: ")) continue;
        let data;
        try { data = JSON.parse(block.slice(6)); } catch { continue; }

        events.push(data);

        if (data.type === "chunk") {
          if (!firstChunkTime) firstChunkTime = performance.now();
          fullText += data.chunk || "";
        }
        if (data.type === "tool_use") toolCalls.push(data.tool_use_message || data);
        if (data.type === "product_results") productResults.push(...(data.products || []));
        if (data.type === "error") error = data.error || "Unknown error";
      }
    }
  } catch (err) {
    error = err.name === "AbortError" ? `Timeout after ${TIMEOUT_MS}ms` : err.message;
  }

  const endTime = performance.now();
  return {
    conversationId,
    message,
    responseText: fullText,
    ttft: firstChunkTime ? firstChunkTime - startTime : null,
    totalTime: endTime - startTime,
    toolCalls,
    productResults,
    events,
    error,
  };
}

// ── LLM Judge ───────────────────────────────────────────────────────
async function judge(context, response, criteria) {
  if (!process.env.OPENAI_API_KEY) {
    return { pass: null, score: 0, issues: ["No OPENAI_API_KEY — judge skipped"] };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: `You are a strict QA judge evaluating a Shopify store chatbot. The store sells aftermarket automotive parts (coilovers, exhaust systems, suspension kits, etc.) for the store "Dev NLP Brochure" at dev-nlp-brochure.myshopify.com.

Evaluate the chatbot response and return JSON:
{
  "pass": true/false,
  "score": 1-10,
  "issues": ["list of specific issues found"],
  "summary": "one-line summary"
}

Scoring guide:
- 9-10: Perfect response, helpful, accurate, good formatting
- 7-8: Good response, minor issues (slightly verbose, could be better)
- 5-6: Acceptable but has notable problems (wrong info, too vague, formatting issues)
- 3-4: Poor response (unhelpful, confusing, broken links, fabricated info)
- 1-2: Critically broken (error, empty, completely wrong)

Be strict about:
- Links MUST point to real store URLs (dev-nlp-brochure.myshopify.com), not example.com
- Product info should come from the actual catalog, not fabricated
- Responses should be concise and helpful
- The bot should NOT hallucinate products or URLs that don't exist
- If product cards are shown alongside text, the text should be brief (not repeat all product details)`,
        },
        {
          role: "user",
          content: `CONVERSATION CONTEXT:
${context}

CHATBOT RESPONSE:
${response || "(empty response)"}

PRODUCT CARDS SHOWN: ${criteria.productCards || "none"}

EVALUATION CRITERIA:
${criteria.judge}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content || "";
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { pass: null, score: 0, issues: [`Non-JSON: ${content}`] };
    } catch {
      return { pass: null, score: 0, issues: [`Parse error: ${content.substring(0, 200)}`] };
    }
  } catch (err) {
    return { pass: null, score: 0, issues: [`Judge error: ${err.message}`] };
  }
}

// ── Multi-turn conversation runner ──────────────────────────────────
async function runConversation(scenario) {
  const conversationId = `judge_${scenario.name.replace(/\s+/g, '_')}_${Date.now()}`;
  const results = [];
  let contextLog = "";

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  SCENARIO: ${scenario.name}`);
  console.log(`  ${scenario.description}`);
  console.log(`${"=".repeat(70)}`);

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const turnNum = i + 1;

    console.log(`\n  [Turn ${turnNum}/${scenario.turns.length}] Customer: "${turn.message}"`);
    if (turn.page) console.log(`  Page: ${turn.page}`);

    const result = await sendMessage(conversationId, turn.message, turn.page);

    // Build context log for multi-turn evaluation
    contextLog += `\nCustomer: "${turn.message}"`;
    if (turn.page) contextLog += ` (on page: ${turn.page})`;
    contextLog += `\nBot: ${result.responseText || "(empty)"}`;
    if (result.productResults.length > 0) {
      contextLog += `\n[Product cards shown: ${result.productResults.map(p => p.title).join(", ")}]`;
    }
    contextLog += "\n";

    // Print response info
    const ttftStr = result.ttft ? `${Math.round(result.ttft)}ms` : "N/A";
    const totalStr = `${Math.round(result.totalTime)}ms`;
    console.log(`  TTFT: ${ttftStr} | Total: ${totalStr} | Chars: ${result.responseText.length} | Tools: ${result.toolCalls.length} | Products: ${result.productResults.length}`);

    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
    }

    if (VERBOSE && result.responseText) {
      console.log(`  Response: ${result.responseText.substring(0, 300)}${result.responseText.length > 300 ? "..." : ""}`);
    }

    // Judge this turn
    const productCardInfo = result.productResults.length > 0
      ? result.productResults.map(p => `${p.title} ($${p.price}) - ${p.url || "no URL"}`).join("; ")
      : "none";

    const judgeResult = await judge(
      contextLog,
      result.responseText,
      { judge: turn.judge, productCards: productCardInfo }
    );

    const scoreColor = judgeResult.score >= 7 ? "GOOD" : judgeResult.score >= 5 ? "OK" : "BAD";
    const passStr = judgeResult.pass === true ? "PASS" : judgeResult.pass === false ? "FAIL" : "SKIP";
    console.log(`  Judge: ${passStr} (${judgeResult.score}/10 ${scoreColor}) — ${judgeResult.summary || ""}`);

    if (judgeResult.issues && judgeResult.issues.length > 0) {
      for (const issue of judgeResult.issues) {
        console.log(`    - ${issue}`);
      }
    }

    results.push({
      turn: turnNum,
      message: turn.message,
      responseText: result.responseText,
      responseLen: result.responseText.length,
      ttft: result.ttft,
      totalTime: result.totalTime,
      toolCalls: result.toolCalls.length,
      productCards: result.productResults.length,
      error: result.error,
      judgePass: judgeResult.pass,
      judgeScore: judgeResult.score,
      judgeIssues: judgeResult.issues || [],
      judgeSummary: judgeResult.summary || "",
    });
  }

  return { scenario: scenario.name, results };
}

// ── Test scenarios ──────────────────────────────────────────────────
const SCENARIOS = [
  {
    name: "Product Discovery",
    description: "Customer browsing for products, searching different categories",
    turns: [
      {
        message: "Hi! I'm looking for coilovers for my car",
        page: `${STORE_DOMAIN}/`,
        judge: "Should greet customer and ask about their vehicle or show general coilover options. Should NOT fabricate product names or URLs.",
      },
      {
        message: "I have a 2021 Audi A4",
        page: `${STORE_DOMAIN}/`,
        judge: "Should search the catalog for Audi A4 coilovers. If found, show real products with correct store URLs. If not found, say so honestly. Links must be to dev-nlp-brochure.myshopify.com.",
      },
      {
        message: "Do you have anything for exhaust systems too?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should search for exhaust systems. Should understand this is a follow-up in the same conversation. Products shown should be real catalog items.",
      },
      {
        message: "What's the most popular product you sell?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should either search catalog and show popular items or honestly say it doesn't have popularity data. Should NOT make up bestseller claims.",
      },
    ],
  },
  {
    name: "Fitment Check",
    description: "Customer checking if a specific product fits their vehicle",
    turns: [
      {
        message: "Does this fit my 2023 Toyota Tundra?",
        page: `${STORE_DOMAIN}/products/bilstein-2022-toyota-tundra-4wd-b8-8112-black-hawk-3-way-adj-coilover`,
        judge: "Should check the product page and fitment data. Must give a clear yes/no/uncertain answer about 2023 Toyota Tundra compatibility. Should reference the actual product details.",
      },
      {
        message: "What about my friend's 2019 Tacoma?",
        page: `${STORE_DOMAIN}/products/bilstein-2022-toyota-tundra-4wd-b8-8112-black-hawk-3-way-adj-coilover`,
        judge: "Should address whether this Tundra product fits a 2019 Tacoma (likely no, different vehicle). Should give a clear answer, not be evasive.",
      },
      {
        message: "Can you find me something that does fit the 2019 Tacoma?",
        page: `${STORE_DOMAIN}/products/bilstein-2022-toyota-tundra-4wd-b8-8112-black-hawk-3-way-adj-coilover`,
        judge: "Should search the catalog for 2019 Tacoma compatible products. If found, show them. If not, say so. Should NOT fabricate products.",
      },
    ],
  },
  {
    name: "Purchasing Questions",
    description: "Customer asking about buying, shipping, returns",
    turns: [
      {
        message: "How much does shipping cost?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should provide shipping information or honestly say it needs to check. Should NOT fabricate specific shipping rates unless the store data provides them.",
      },
      {
        message: "What's your return policy?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should provide return policy info or direct customer to the policy page. Should be helpful even if exact policy isn't known.",
      },
      {
        message: "Do you offer price matching?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should address the price matching question. It's OK to say it doesn't have that information and suggest contacting support.",
      },
      {
        message: "Can I pay with PayPal?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should address payment methods. It's OK to be general or suggest checking checkout. Should NOT fabricate payment options.",
      },
    ],
  },
  {
    name: "Multi-Vehicle Comparison",
    description: "Customer comparing products for different vehicles",
    turns: [
      {
        message: "I need suspension upgrades for my 2020 Ford Mustang GT",
        page: `${STORE_DOMAIN}/`,
        judge: "Should search for Ford Mustang suspension products. Results should come from actual catalog. URLs must be correct store domain.",
      },
      {
        message: "What about for a 2022 Dodge Challenger too?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should search for Dodge Challenger suspension. Should maintain conversation context (customer is comparing for two vehicles).",
      },
      {
        message: "Which option would give a better ride quality for daily driving?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should attempt to compare the products found for both vehicles. If products were found, should reference them. If not, should be honest. Should give practical advice.",
      },
    ],
  },
  {
    name: "Edge Cases and Natural Chat",
    description: "Testing conversational flow, edge cases, and natural language",
    turns: [
      {
        message: "yo what's up",
        page: `${STORE_DOMAIN}/`,
        judge: "Should respond casually and helpfully. Should not be overly formal or robotic. A simple friendly greeting is fine.",
      },
      {
        message: "im not sure what I need tbh, my car rides rough and I want to fix it",
        page: `${STORE_DOMAIN}/`,
        judge: "Should ask clarifying questions about the vehicle (make, model, year) and suggest suspension products might help. Should be consultative.",
      },
      {
        message: "it's a 2018 BMW 3 series",
        page: `${STORE_DOMAIN}/`,
        judge: "Should search for BMW 3 series suspension/coilover products. Should provide helpful results or honestly say what's available.",
      },
      {
        message: "thanks! one more thing - do you guys have a physical store I can visit?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should address the physical store question. It's OK to say it doesn't have that info and suggest checking the website contact page.",
      },
      {
        message: "ok I'll probably order online then. how long till it ships?",
        page: `${STORE_DOMAIN}/`,
        judge: "Should address shipping timeline. Should be helpful even if exact info isn't available. Should NOT fabricate specific delivery dates.",
      },
    ],
  },
  {
    name: "Product Page Deep Dive",
    description: "Customer on a specific product page asking detailed questions",
    turns: [
      {
        message: "Tell me more about this product",
        page: `${STORE_DOMAIN}/products/akrapovic-2021-audi-rs-3-8y-sedan-evolution-line-exhaust-titanium`,
        judge: "Should fetch product details and describe the Akrapovic exhaust. Should use real catalog data, not fabricate specs.",
      },
      {
        message: "Is this made of real titanium?",
        page: `${STORE_DOMAIN}/products/akrapovic-2021-audi-rs-3-8y-sedan-evolution-line-exhaust-titanium`,
        judge: "Should reference the product's actual materials info. If 'titanium' is in the title/description, should confirm. Should not make up manufacturing details.",
      },
      {
        message: "Would this void my car's warranty?",
        page: `${STORE_DOMAIN}/products/akrapovic-2021-audi-rs-3-8y-sedan-evolution-line-exhaust-titanium`,
        judge: "Should give a reasonable answer about aftermarket parts and warranty. It's OK to recommend checking with the dealership. Should NOT give definitive legal advice.",
      },
      {
        message: "What's the price?",
        page: `${STORE_DOMAIN}/products/akrapovic-2021-audi-rs-3-8y-sedan-evolution-line-exhaust-titanium`,
        judge: "Should provide the actual price from the catalog. If shown in product data, must be accurate. Should NOT fabricate a price.",
      },
    ],
  },
  {
    name: "Human Handoff NLP",
    description: "Testing natural language triggers for human handoff",
    turns: [
      {
        message: "I have a question about a custom order",
        page: `${STORE_DOMAIN}/`,
        judge: "Should try to help with the custom order question. Should NOT immediately trigger handoff — this is a normal question.",
      },
      {
        message: "Actually, I'd rather talk to a real person about this",
        page: `${STORE_DOMAIN}/`,
        judge: "Should detect handoff intent and acknowledge that a team member has been notified. Should set pending_merchant mode. The response should be helpful, not just 'please wait'.",
      },
    ],
  },
];

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(70));
  console.log("  COMPREHENSIVE CUSTOMER JUDGE AGENT");
  console.log(`  Target: ${CHAT_ENDPOINT}`);
  console.log(`  Store: ${STORE_DOMAIN}`);
  console.log(`  Timeout: ${TIMEOUT_MS}ms`);
  console.log(`  Judge: ${process.env.OPENAI_API_KEY ? "enabled" : "DISABLED (no OPENAI_API_KEY)"}`);
  console.log("=".repeat(70));

  // Test connectivity first
  try {
    const probe = await sendMessage("judge_probe", "test", `${STORE_DOMAIN}/`);
    if (probe.error) throw new Error(probe.error);
    console.log(`\n  Connectivity: OK (TTFT: ${Math.round(probe.ttft || 0)}ms)`);
  } catch (err) {
    console.error(`\n  Connectivity FAILED: ${err.message}`);
    console.error("  Make sure the dev server is running (npx shopify app dev)");
    process.exit(1);
  }

  const scenariosToRun = SCENARIO_FILTER
    ? SCENARIOS.filter(s => s.name.toLowerCase().includes(SCENARIO_FILTER.toLowerCase()))
    : SCENARIOS;

  if (scenariosToRun.length === 0) {
    console.error(`\n  No scenarios matching "${SCENARIO_FILTER}"`);
    console.error(`  Available: ${SCENARIOS.map(s => s.name).join(", ")}`);
    process.exit(1);
  }

  const allResults = [];
  for (const scenario of scenariosToRun) {
    const result = await runConversation(scenario);
    allResults.push(result);
  }

  // ── Final Report ────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("  FINAL REPORT");
  console.log(`${"=".repeat(70)}\n`);

  let totalTurns = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalScore = 0;
  let scoredTurns = 0;
  const allIssues = [];

  for (const scenario of allResults) {
    const scores = scenario.results.filter(r => r.judgeScore > 0).map(r => r.judgeScore);
    const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "N/A";
    const passCount = scenario.results.filter(r => r.judgePass === true).length;
    const failCount = scenario.results.filter(r => r.judgePass === false).length;
    const errorCount = scenario.results.filter(r => r.error).length;

    console.log(`  ${scenario.scenario}: avg ${avgScore}/10 | ${passCount} pass, ${failCount} fail, ${errorCount} errors`);

    for (const r of scenario.results) {
      totalTurns++;
      if (r.judgePass === true) totalPass++;
      if (r.judgePass === false) totalFail++;
      if (r.judgeScore > 0) { totalScore += r.judgeScore; scoredTurns++; }

      for (const issue of r.judgeIssues) {
        allIssues.push({ scenario: scenario.scenario, turn: r.turn, message: r.message, issue });
      }
    }
  }

  const overallAvg = scoredTurns > 0 ? (totalScore / scoredTurns).toFixed(1) : "N/A";
  console.log(`\n  OVERALL: ${overallAvg}/10 avg | ${totalPass} pass, ${totalFail} fail | ${totalTurns} total turns`);

  if (allIssues.length > 0) {
    console.log(`\n  ISSUES FOUND (${allIssues.length}):`);
    console.log(`  ${"—".repeat(66)}`);
    for (const { scenario, turn, message, issue } of allIssues) {
      console.log(`  [${scenario} T${turn}] "${message.substring(0, 40)}${message.length > 40 ? '...' : ''}"`);
      console.log(`    → ${issue}`);
    }
  }

  // Performance summary
  const allTtfts = allResults.flatMap(s => s.results).filter(r => r.ttft).map(r => r.ttft);
  const allTotals = allResults.flatMap(s => s.results).map(r => r.totalTime);
  if (allTtfts.length > 0) {
    const avgTtft = (allTtfts.reduce((a, b) => a + b, 0) / allTtfts.length);
    const avgTotal = (allTotals.reduce((a, b) => a + b, 0) / allTotals.length);
    const maxTotal = Math.max(...allTotals);
    console.log(`\n  PERFORMANCE:`);
    console.log(`    Avg TTFT: ${Math.round(avgTtft)}ms`);
    console.log(`    Avg total: ${Math.round(avgTotal)}ms`);
    console.log(`    Max total: ${Math.round(maxTotal)}ms`);
  }

  console.log();
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
