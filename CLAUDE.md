# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Shopify template app that embeds an AI-powered chat widget on storefronts. Shoppers can search products, ask about policies, manage carts, track orders, and initiate returns — all via natural language. The backend uses OpenAI with Shopify's Model Context Protocol (MCP) for tool invocation.

## Development Commands

```bash
npm run dev              # Start dev server (runs shopify app dev, which handles tunneling)
npm run build            # Production build (react-router build)
npm run start            # Serve production build
npm run setup            # Generate Prisma client + run migrations
npm run lint             # ESLint (uses .gitignore for ignore patterns)
npm run typecheck        # React Router typegen + tsc --noEmit
npm run deploy           # Deploy to Shopify (shopify app deploy)
```

The dev server runs on port 3458 (configured in `shopify.web.toml`). On `predev`, Prisma client is generated; on `dev`, migrations are deployed before starting React Router.

## Architecture

**Two main components:**

1. **Backend (React Router server)** — handles chat messages, streams responses via SSE, orchestrates OpenAI + MCP tool calls
2. **Chat UI (Shopify theme extension)** — `extensions/chat-bubble/` provides the storefront-facing chat widget

**Request flow (optimized — parallelized for <2s TTFT):**
1. Chat bubble (`extensions/chat-bubble/assets/chat.js`) sends POST to `/chat` endpoint
2. `app/routes/chat.jsx` receives the request
3. **Phase 1 (parallel):** `getCustomerAccountUrls()`, `connectToStorefrontServer()`, and `saveMessage() → getConversationHistory()` run concurrently via `Promise.allSettled`
4. **Phase 2 (parallel):** Customer MCP connection (500ms timeout) and fitment auto-search (if on product page with fitment question) run concurrently via `Promise.all`
5. OpenAI service streams a completion with MCP tools converted to OpenAI function-calling format
6. When OpenAI returns `finish_reason: "tool_calls"`, tools are executed via MCP, results fed back, and the loop continues until a final text response
7. Response is streamed back to the client via SSE; messages are persisted to the database

**Key services in `app/services/`:**
- `openai.server.js` — OpenAI client creation, MCP→OpenAI tool conversion, streaming completions. Maps `finish_reason: "tool_calls"` → `stop_reason: "tool_use"` to keep the while loop running for multi-turn tool calls
- `tool.server.js` — Tool response processing, product search result formatting. Supports fitment-aware mode (`fitment_search:true` in context) with broader results (20 products) and current-product exclusion
- `streaming.server.js` — SSE StreamManager with backpressure handling
- `websearch.server.js` — DuckDuckGo web search integration (no API key needed)
- `config.server.js` — Centralized config (model name, max tokens: 1200, prompt type, conversation max history: 20 messages, tool settings including `maxFitmentSearchProducts: 20`)

**Other key files:**
- `app/mcp-client.js` — MCP protocol client; connects to customer MCP (authenticated) and storefront MCP (public), handles JSON-RPC
- `app/db.server.js` — Prisma database operations (sessions, conversations, messages, customer tokens, PKCE code verifiers)
- `app/auth.server.js` — OAuth 2.0 + PKCE flow for customer account access
- `app/prompts/prompts.json` — System prompts v4.0 (two variants: `standardAssistant` and `enthusiasticAssistant`). Condensed with two-layer fitment search instructions. `enthusiasticAssistant` has a `personalityPrefix` field

## Database

SQLite via Prisma. Schema at `prisma/schema.prisma`. Models: Session, CustomerToken, CodeVerifier, Conversation, Message, CustomerAccountUrls.

```bash
npx prisma generate          # Regenerate client after schema changes
npx prisma migrate dev       # Create new migration during development
npx prisma migrate deploy    # Apply migrations
```

## Environment Variables

Required in `.env`:
- `OPENAI_API_KEY` — OpenAI API key
- `SHOPIFY_API_KEY` — Shopify app API key (also set via `shopify.app.toml` client_id)

## Shopify App Config

- `shopify.app.toml` — App identity, scopes, auth redirects. API version: `2025-04`.
- Access scopes: `customer_read_customers`, `customer_read_orders`, `customer_read_store_credit_account_transactions`, `customer_read_store_credit_accounts`, `unauthenticated_read_product_listings`
- The app is embedded (`embedded = true`).
- Workspaces: `extensions/*` (monorepo — extensions are npm workspaces).

## Theme Extension

`extensions/chat-bubble/` is a Shopify theme app extension:
- `blocks/chat-interface.liquid` — Liquid block with merchant-configurable settings (bubble color, welcome message, prompt selection)
- `assets/chat.js` — Client-side chat logic (UI interactions, API calls, SSE handling, message rendering)
- `assets/chat.css` — Chat widget styling (responsive, mobile-aware)

## LLM Configuration

Default model is set in `app/services/config.server.js` (`AppConfig.api.defaultModel`). The system prompt is selected from `app/prompts/prompts.json` based on `AppConfig.api.defaultPromptType`. To swap LLMs or customize behavior, modify these files.

## Two-Layer Fitment Search

When a customer asks a fitment/compatibility question on a product page:

1. **Auto-search (Phase 2, parallel):** `chat.jsx` detects the fitment question + product page URL, fires `search_shop_catalog` with the product handle in parallel with customer MCP connection — adds zero extra latency
2. **Context injection:** Results are injected into conversation history as `[AUTO-SEARCHED PRODUCT CONTEXT]` so the AI has product details (title, SKU, description, tags) before its first turn
3. **AI answers directly:** The system prompt instructs the AI to read the description for fitment data (format: "Year1-Year2, Make Model") and give a direct answer
4. **Web verification (Layer 2):** If description data is ambiguous (e.g., year range is close but doesn't cover), the AI uses `web_search` to verify online
5. **Alternative search:** If the product doesn't fit, the AI searches by PRODUCT CATEGORY ONLY (never vehicle info in query) with `fitment_search:true` context, gets 20 results, excludes current product, and filters by reading descriptions
6. **Search suppression:** `onToolUse` in `chat.jsx` detects redundant searches (same product handle already in tool results) and skips them

## Response Speed Optimizations

Target: time-to-first-token (TTFT) under 2 seconds. Key changes:

- **Parallelized pre-stream ops** (`chat.jsx`): Phase 1 uses `Promise.allSettled` for independent operations; Phase 2 uses `Promise.all` for customer MCP + fitment auto-search
- **Conversation history sliding window**: Capped at 20 messages (`AppConfig.conversation.maxHistoryMessages`) to prevent unbounded token growth
- **Reduced max_completion_tokens**: 2000 → 1200 (most responses well under this)
- **Condensed system prompts**: Both prompt variants reduced ~40% (verbose formatting guidelines removed, fitment instructions compressed into decision tree)
- **Removed debug logging**: All `fetch('http://127.0.0.1:7244/...')` debug log blocks removed from `chat.jsx`, `openai.server.js`, `env.server.js`, `streaming.server.js`
- **Customer MCP timeout**: Reduced to 500ms with graceful fallback

## Testing

`tests/chat-test.mjs` — Conversation testing agent:
```bash
node tests/chat-test.mjs                    # Basic speed test (requires dev server running)
node tests/chat-test.mjs --judge            # With LLM quality judge (uses gpt-4o-mini)
node tests/chat-test.mjs --verbose          # Show full response text
node tests/chat-test.mjs --base-url <url>   # Test against custom URL
node tests/chat-test.mjs --target 3000      # Custom TTFT target in ms
```
Tests 5 scenarios: simple greeting, product search, fitment question, return policy, follow-up. Measures TTFT and total response time. `--judge` uses OpenAI to evaluate answer quality.

## Workflow Rules

### Planning & Execution
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions).
- If something goes sideways, STOP and re-plan immediately — don't keep pushing.
- Use plan mode for verification steps, not just building.
- Write detailed specs upfront to reduce ambiguity.
- Plan first: write plan to `tasks/todo.md` with checkable items. Check in before starting implementation. Mark items complete as you go. Add a review section to `tasks/todo.md` when done.

### Subagent Strategy
- Use subagents liberally to keep the main context window clean.
- Offload research, exploration, and parallel analysis to subagents.
- For complex problems, throw more compute at it via subagents.
- One task per subagent for focused execution.

### Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern.
- Write rules for yourself that prevent the same mistake.
- Ruthlessly iterate on these lessons until mistake rate drops.
- Review `tasks/lessons.md` at session start for relevant project context.

### Verification Before Done
- Never mark a task complete without proving it works.
- Diff behavior between main and your changes when relevant.
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness.

### Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution."
- Skip this for simple, obvious fixes — don't over-engineer.
- Challenge your own work before presenting it.

### Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them.
- Zero context switching required from the user.
- Go fix failing CI tests without being told how.

### Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
