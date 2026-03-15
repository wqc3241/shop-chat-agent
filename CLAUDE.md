# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Shopify app that embeds an AI-powered chat widget on storefronts. Shoppers can search products, ask about policies, manage carts, track orders, and initiate returns — all via natural language. The backend uses OpenAI with Shopify's Model Context Protocol (MCP) for tool invocation.

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

The dev server port is dynamic (assigned by Vite at startup). On `predev`, Prisma client is generated; on `dev`, migrations are deployed before starting React Router. The Shopify CLI also starts a proxy on a separate port and a Cloudflare tunnel.

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
- `openai.server.js` — OpenAI client creation, MCP→OpenAI tool conversion, streaming completions
- `tool.server.js` — Tool response processing, product search result formatting
- `streaming.server.js` — SSE StreamManager with backpressure handling
- `websearch.server.js` — OpenAI-backed web search (Responses API)
- `config.server.js` — Centralized config (model, max tokens: 1200, prompt type, conversation max history: 20)

**Other key files:**
- `app/mcp-client.js` — MCP protocol client; connects to customer MCP (authenticated) and storefront MCP (public), handles JSON-RPC
- `app/db.server.js` — Prisma database operations (sessions, conversations, messages, customer tokens, PKCE code verifiers)
- `app/auth.server.js` — OAuth 2.0 + PKCE flow for customer account access
- `app/prompts/prompts.json` — System prompts v6.0 (two variants: `standardAssistant` and `enthusiasticAssistant`)

## Database

PostgreSQL via Prisma. Schema at `prisma/schema.prisma`. Models: Session, CustomerToken, CodeVerifier, Conversation, Message, CustomerAccountUrls, ChatSettings, CustomerActivity. Requires `DATABASE_URL` env var.

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

- `shopify.app.shop-chat-agent.toml` — **Active config** (client_id `4c027b857aefc723b419e183d880dbef`, under org 129937154).
- Access scopes: `customer_read_customers`, `customer_read_orders`, `customer_read_store_credit_account_transactions`, `customer_read_store_credit_accounts`, `unauthenticated_read_product_listings`, `read_products`, `read_legal_policies`
- Dev store: `dev-nlp-brochure-2.myshopify.com` (Partners-managed under org 129937154).
- GDPR webhooks use `compliance_topics` (not `topics`) in the toml — Shopify CLI rejects `topics` for compliance webhooks.
- The app proxy config (`[app_proxy]`) has `automatically_update_urls_on_dev = true`.

## Production Deployment

Hosted on Fly.io:
- **App**: `nlp-shop-chat-agent` at `https://nlp-shop-chat-agent.fly.dev`
- **Database**: `nlp-shop-chat-agent-db` (Fly Postgres 17, region `iad`)
- **Dockerfile**: `node:20-alpine`, uses `npm ci --omit=dev --legacy-peer-deps`
- **Startup**: `npm run docker-start` runs `prisma generate && prisma migrate deploy && react-router-serve`
- **Health check**: `GET /health` returns `{"status":"ok"}`
- **Privacy policy**: `GET /privacy` serves GDPR-compliant privacy page
- **fly.toml**: Sets `HOST=0.0.0.0` (required for react-router-serve to bind correctly in container)
- **DB auto-stop disabled**: DB machine configured with `--autostop=off --restart=always`
- **Secrets**: `DATABASE_URL`, `OPENAI_API_KEY`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`
- **Deploy**: `fly deploy --app nlp-shop-chat-agent` (requires flyctl at `~/.fly/bin/flyctl`)

### Shopify Org/Store Hierarchy

- Apps created under a **standalone dev store** are invisible in the Partners Dashboard and can only be installed on that one store.
- Apps created via `shopify app config link` under a **Partners org** are visible in the dev dashboard and can be installed on any store in that org.
- Current app is under org **129937154** ("Next Level Performance") at `dev.shopify.com/dashboard/129937154/apps`.

## Theme Extension

`extensions/chat-bubble/` is a Shopify theme app extension:
- `blocks/chat-interface.liquid` — Liquid block with merchant-configurable settings
- `assets/chat.js` — Client-side chat logic (UI, API calls, SSE, message rendering)
- `assets/chat.css` — Chat widget styling (responsive, mobile-aware)

## Conversational Shopping Assistant (System Prompt v6.0)

The AI acts as a real in-store shopping assistant:
- **Vague requests** ("I want a snowboard"): asks clarifying questions about budget, skill level, preferences before searching
- **Specific requests** ("show me snowboards under $700"): searches immediately with filters
- **Catalog browsing** ("what do you carry?"): searches and shows products right away
- **Search queries**: ALWAYS use short product keywords, NEVER the full customer message. Shopify MCP `search_shop_catalog` uses keyword matching, not natural language.
- **Result curation**: present 2-3 best matches with reasoning, don't dump all results

## Live Chat Admin UI

`app/routes/app.live-chat.jsx` — 3-panel admin workspace:

- **Left panel**: Conversation queue with online/offline status dots (green = active within 30s)
- **Center panel**: Active thread with message history
- **Right panel (scrollable)**: Customer details, order context (clickable links to Shopify admin), quick actions, live activity

### Live Activity Section
- Shows customer's current browsing page (clickable link)
- Viewed product with title/price (clickable)
- Cart contents with item titles (clickable links to product pages) and total amount
- All links in Live Activity are interactive — merchant can click to view the actual pages/products

### Customer Online/Offline Status
- Storefront sends lightweight heartbeat ping every 15s
- Heartbeat response returns current conversation mode (for takeover detection)
- Admin shows green dot + "Online" when `CustomerActivity.updatedAt` < 30s ago
- Gray dot when customer is offline
- Status dots shown on both conversation list avatars and detail sidebar

### Merchant Takeover Flow
- Polling for merchant messages only starts when merchant takes over (not always-on)
- Heartbeat (15s) detects mode changes — when mode becomes `merchant`, polling (3s) starts
- When mode returns to `ai`, polling stops automatically
- Polling stops during SSE stream to prevent duplicate messages, resumes after

## Customer Activity Tracking (Event-Driven)

- **No polling** — activity is event-driven, not interval-based
- **Page load**: sends page URL, title, product info once on init
- **Cart mutations**: monkey-patches `fetch()` and `XMLHttpRequest` to intercept `/cart/add.js`, `/cart/change.js`, `/cart/update.js`, `/cart/clear.js`
- **On cart change**: waits 500ms, fetches `/cart.js` once, sends update to backend
- **Heartbeat**: lightweight ping every 15s for online status
- **Backend**: `GET /chat?activity=true&conversation_id=X` with truncated fields (URL length safe)

## Store Policy Sync

- Store policies (return, shipping, terms, contact) are **auto-synced from Shopify admin** — no manual input needed
- Settings page fetches policies via **Admin GraphQL API** (`shop.shopPolicies` query, requires `read_legal_policies` scope)
- Shows "Policy Sync Status" bar with last synced time and "Re-sync" button
- Scrollable preview of synced policies with HTML stripped
- Only `customInstructions` field remains for merchant input (brand voice, promotions)
- AI uses `search_shop_policies_and_faqs` MCP tool at runtime to answer policy questions (note: MCP has indexing delay for newly added policies)

## Chat History Persistence

- Conversation ID stored in **`localStorage`** (not sessionStorage) so history persists across tabs and new-tab link clicks
- Product links in chat open in new tabs (`target="_blank"`) — localStorage ensures history survives
- All messages show timestamps (HH:MM format)
- History messages show `createdAt` from DB; new messages show current time

## Customer Feedback (Thumbs Up/Down)

- SVG thumbs up/down icons (not emoji) with green/red color states
- `formatMessageContent()` preserves feedback buttons and timestamps when reformatting markdown (clones and re-attaches after innerHTML replacement)
- Feedback buttons appear on streamed AI messages via `message_id` SSE event
- Timestamps added to streamed messages when element is first created

## Shopify App Proxy Constraints

Key behaviors to know when sending requests through the proxy (`/apps/chat-agent/chat`):
- **POST requests**: Only the main chat SSE endpoint works reliably via POST. Activity updates must use GET.
- **Content-Type conversion**: Proxy converts `application/json` POST bodies to `application/x-www-form-urlencoded`
- **Error masking**: Non-200 responses get replaced with store's HTML error page
- **Added parameters**: Proxy adds `shop`, `logged_in_customer_id`, `path_prefix`, `timestamp`, `signature`

## Testing

`tests/chat-test.mjs` — Conversation testing agent:
```bash
node tests/chat-test.mjs                         # Basic speed test
node tests/chat-test.mjs --judge                  # With LLM quality judge (gpt-4o-mini)
node tests/chat-test.mjs --verbose                # Show full response text
node tests/chat-test.mjs --base-url <url>         # Test against custom URL
node tests/chat-test.mjs --store-domain <domain>  # Custom store domain
```

Test scenarios: greeting, product search, fitment, policies (return, shipping, contact), follow-up, conversational shopping (vague/specific/browsing/gift requests), keyword extraction, order tracking.

E2E tests: feedback (both values), activity tracking, conversation persistence, MCP policy tool accessibility, timestamp/message_id verification.

## Workflow Rules

### Planning & Execution
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions).
- Plan first: write plan to `tasks/todo.md` with checkable items.

### Subagent Strategy
- Use subagents liberally to keep the main context window clean.
- One task per subagent for focused execution.

### Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern.

### Core Principles
- **Simplicity First**: Make every change as simple as possible.
- **No Laziness**: Find root causes. No temporary fixes.
- **Minimal Impact**: Changes should only touch what's necessary.
