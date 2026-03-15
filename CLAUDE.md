# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Shopify template app that embeds an AI-powered chat widget on storefronts. Shoppers can search products, ask about policies, manage carts, track orders, and initiate returns �?all via natural language. The backend uses OpenAI with Shopify's Model Context Protocol (MCP) for tool invocation.

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

The dev server port is dynamic (assigned by Vite at startup �?check terminal output or use `netstat` to find it). On `predev`, Prisma client is generated; on `dev`, migrations are deployed before starting React Router. The Shopify CLI also starts a proxy on a separate port and a Cloudflare tunnel.

## Architecture

**Two main components:**

1. **Backend (React Router server)** �?handles chat messages, streams responses via SSE, orchestrates OpenAI + MCP tool calls
2. **Chat UI (Shopify theme extension)** �?`extensions/chat-bubble/` provides the storefront-facing chat widget

**Request flow (optimized �?parallelized for <2s TTFT):**
1. Chat bubble (`extensions/chat-bubble/assets/chat.js`) sends POST to `/chat` endpoint
2. `app/routes/chat.jsx` receives the request
3. **Phase 1 (parallel):** `getCustomerAccountUrls()`, `connectToStorefrontServer()`, and `saveMessage() �?getConversationHistory()` run concurrently via `Promise.allSettled`
4. **Phase 2 (parallel):** Customer MCP connection (500ms timeout) and fitment auto-search (if on product page with fitment question) run concurrently via `Promise.all`
5. OpenAI service streams a completion with MCP tools converted to OpenAI function-calling format
6. When OpenAI returns `finish_reason: "tool_calls"`, tools are executed via MCP, results fed back, and the loop continues until a final text response
7. Response is streamed back to the client via SSE; messages are persisted to the database

**Key services in `app/services/`:**
- `openai.server.js` �?OpenAI client creation, MCP→OpenAI tool conversion, streaming completions. Maps `finish_reason: "tool_calls"` �?`stop_reason: "tool_use"` to keep the while loop running for multi-turn tool calls
- `tool.server.js` �?Tool response processing, product search result formatting. Supports fitment-aware mode (`fitment_search:true` in context) with broader results (20 products) and current-product exclusion
- `streaming.server.js` �?SSE StreamManager with backpressure handling
- `websearch.server.js` �?DuckDuckGo web search integration (no API key needed)
- `config.server.js` �?Centralized config (model name, max tokens: 1200, prompt type, conversation max history: 20 messages, tool settings including `maxFitmentSearchProducts: 20`)

**Other key files:**
- `app/mcp-client.js` �?MCP protocol client; connects to customer MCP (authenticated) and storefront MCP (public), handles JSON-RPC
- `app/db.server.js` �?Prisma database operations (sessions, conversations, messages, customer tokens, PKCE code verifiers)
- `app/auth.server.js` �?OAuth 2.0 + PKCE flow for customer account access
- `app/prompts/prompts.json` �?System prompts v4.0 (two variants: `standardAssistant` and `enthusiasticAssistant`). Condensed with two-layer fitment search instructions. `enthusiasticAssistant` has a `personalityPrefix` field

## Database

PostgreSQL via Prisma. Schema at `prisma/schema.prisma`. Models: Session, CustomerToken, CodeVerifier, Conversation, Message, CustomerAccountUrls, ChatSettings, CustomerActivity. Requires `DATABASE_URL` env var.

```bash
npx prisma generate          # Regenerate client after schema changes
npx prisma migrate dev       # Create new migration during development
npx prisma migrate deploy    # Apply migrations
```

## Environment Variables

Required in `.env`:
- `OPENAI_API_KEY` �?OpenAI API key
- `SHOPIFY_API_KEY` �?Shopify app API key (also set via `shopify.app.toml` client_id)

## Shopify App Config

- `shopify.app.shop-chat-agent.toml` — **Active config** (client_id `4c027b857aefc723b419e183d880dbef`, under org 129937154).
- The app proxy config (`[app_proxy]`) has `automatically_update_urls_on_dev = true`, so `shopify app dev` updates the proxy URL to the current Cloudflare tunnel.
- Access scopes: `customer_read_customers`, `customer_read_orders`, `customer_read_store_credit_account_transactions`, `customer_read_store_credit_accounts`, `unauthenticated_read_product_listings`, `read_products`
- The app is embedded (`embedded = true`).
- Workspaces: `extensions/*` (monorepo — extensions are npm workspaces).
- Dev store: `dev-nlp-brochure-2.myshopify.com` (Partners-managed under org 129937154).
- GDPR webhooks use `compliance_topics` (not `topics`) in the toml — Shopify CLI rejects `topics` for compliance webhooks.

## Production Deployment

Hosted on Fly.io:
- **App**: `nlp-shop-chat-agent` at `https://nlp-shop-chat-agent.fly.dev`
- **Database**: `nlp-shop-chat-agent-db` (Fly Postgres 17, region `iad`)
- **Dockerfile**: `node:20-alpine`, uses `npm ci --omit=dev --legacy-peer-deps` (peer dep conflicts between Shopify packages)
- **Startup**: `npm run docker-start` runs `prisma generate && prisma migrate deploy && react-router-serve`
- **Health check**: `GET /health` returns `{"status":"ok"}`
- **Privacy policy**: `GET /privacy` serves GDPR-compliant privacy page
- **fly.toml**: Sets `HOST=0.0.0.0` (required for react-router-serve to bind correctly in container)
- **DB auto-stop disabled**: DB machine configured with `--autostop=off --restart=always` to prevent Fly from stopping it
- **Secrets**: `DATABASE_URL`, `OPENAI_API_KEY`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`
- **Deploy**: `fly deploy --app nlp-shop-chat-agent` (requires flyctl, installed at `~/.fly/bin/flyctl`)

### Shopify Org/Store Hierarchy

The app went through multiple org migrations. Key lesson:
- Apps created under a **standalone dev store** (not linked to Partners) are invisible in the Partners Dashboard and can only be installed on that one store.
- Apps created via `shopify app config link` under a **Partners org** are visible in the dev dashboard and can be installed on any store in that org.
- Current app is under org **129937154** ("Next Level Performance") in the dev dashboard at `dev.shopify.com/dashboard/129937154/apps`.

## Theme Extension

`extensions/chat-bubble/` is a Shopify theme app extension:
- `blocks/chat-interface.liquid` �?Liquid block with merchant-configurable settings (bubble color, welcome message, prompt selection)
- `assets/chat.js` �?Client-side chat logic (UI interactions, API calls, SSE handling, message rendering)
- `assets/chat.css` �?Chat widget styling (responsive, mobile-aware)

## Live Chat Admin UI

The merchant-facing live chat screen lives in `app/routes/app.live-chat.jsx`.

- The current design is a 3-panel admin workspace: conversation queue on the left, active thread in the center, customer and order details on the right.
- The route intentionally breaks out of Shopify's centered page container so it fills the embedded app width.
- The layout should behave like a fixed-height workspace, not a long document.
- Avoid page-level scrolling. Scrolling should stay inside:
  - the conversation list
  - the message thread
- Keep the right details panel pinned within the available page height whenever possible.
- Keep the composer visible at the bottom of the thread.
- Sending a merchant reply while AI is active or a handoff is pending should first take over the conversation, then send the message.
- Preserve the single-screen operator workflow: merchants should not need to scroll the full page to manage live chats.

## LLM Configuration

Default model is set in `app/services/config.server.js` (`AppConfig.api.defaultModel`). The system prompt is selected from `app/prompts/prompts.json` based on `AppConfig.api.defaultPromptType`. To swap LLMs or customize behavior, modify these files.

## Two-Layer Fitment Search

When a customer asks a fitment/compatibility question on a product page:

1. **Auto-search (Phase 2, parallel):** `chat.jsx` detects the fitment question + product page URL, fires `search_shop_catalog` with the product handle in parallel with customer MCP connection �?adds zero extra latency
2. **Context injection:** Results are injected into conversation history as `[AUTO-SEARCHED PRODUCT CONTEXT]` so the AI has product details (title, SKU, description, tags) before its first turn
3. **AI answers directly:** The system prompt instructs the AI to read the description for fitment data (format: "Year1-Year2, Make Model") and give a direct answer
4. **Web verification (Layer 2):** If description data is ambiguous (e.g., year range is close but doesn't cover), the AI uses `web_search` to verify online
5. **Alternative search:** If the product doesn't fit, the AI searches by PRODUCT CATEGORY ONLY (never vehicle info in query) with `fitment_search:true` context, gets 20 results, excludes current product, and filters by reading descriptions
6. **Search suppression:** `onToolUse` in `chat.jsx` detects redundant searches (same product handle already in tool results) and skips them

### Current Fitment UX Rules

- Polling and history rendering in `extensions/chat-bubble/assets/chat.js` must parse structured message content and only render non-empty `text` blocks.
- Do not render `tool_use` or `tool_result` payloads in storefront polling/history.
- Preserve the original sender role when rendering polled messages; do not force assistant/system messages into `merchant` bubbles.
- The `requestHuman()` storefront SSE path must stay in sync with the main `handleStreamEvent(...)` signature and stream-state handling. If that signature changes, update both paths.
- Empty assistant bubbles during request-human flow are a regression. The storefront should only create visible assistant bubbles when real text content is present.
- Fitment questions should return a direct text answer first: `Yes`, `No`, or `I can't confirm from the catalog data alone`.
- Do not show product cards for fitment questions unless the customer explicitly asks to find or browse products.
- Storefront customers should not see internal tool activity such as `Calling tool: ...`.
- If a fitment turn uses tool activity but produces no visible assistant text, the storefront client shows a fallback fitment message instead of leaving a blank assistant bubble.
- Fitment answers append a short source footnote at the end of the response:
  - `Source: Shopify catalog`
  - `Source: Web search`

### Current Web Search Implementation

- The app-level `web_search` tool is now backed by OpenAI's built-in web search via the Responses API in `app/services/websearch.server.js`.
- This is not Shopify search and no longer uses DuckDuckGo.
- The chat route still exposes `web_search` as an app tool name, but the server fulfills it through OpenAI.
- `web_search` is timeout-limited in `app/routes/chat.jsx` using `AppConfig.timeouts.webSearchMs` to avoid long fitment stalls.

## Response Speed Optimizations

Target: time-to-first-token (TTFT) under 2 seconds. Key changes:

- **Parallelized pre-stream ops** (`chat.jsx`): Phase 1 uses `Promise.allSettled` for independent operations; Phase 2 uses `Promise.all` for customer MCP + fitment auto-search
- **Conversation history sliding window**: Capped at 20 messages (`AppConfig.conversation.maxHistoryMessages`) to prevent unbounded token growth
- **Reduced max_completion_tokens**: 2000 �?1200 (most responses well under this)
- **Condensed system prompts**: Both prompt variants reduced ~40% (verbose formatting guidelines removed, fitment instructions compressed into decision tree)
- **Removed debug logging**: All `fetch('http://127.0.0.1:7244/...')` debug log blocks removed from `chat.jsx`, `openai.server.js`, `env.server.js`, `streaming.server.js`
- **Customer MCP timeout**: Reduced to 500ms with graceful fallback

## Shopify App Proxy Constraints

The storefront chat widget sends requests through the Shopify app proxy (`/apps/chat-agent/chat`). Key behaviors to know:

- **Content-Type conversion**: The proxy converts `application/json` POST bodies to `application/x-www-form-urlencoded`. The `chat.jsx` handler parses both formats: tries `request.json()` if Content-Type is JSON, otherwise reads raw text and tries `JSON.parse` first, then falls back to `URLSearchParams`.
- **Error masking**: If the app returns a non-200 status, the proxy replaces the response body with the store's themed HTML error page (~162KB). You will NOT see your server's error JSON �?only a 500 + HTML. To debug, write errors to a local file (`chat-debug.log`) instead of relying on response bodies.
- **SSE streaming**: Works through the proxy in dev mode, but may buffer in production. Monitor for issues.
- **Stripped headers**: The proxy strips `Cookie` and `Authorization` from requests, and strips `Set-Cookie`, `Connection`, and ~17 other headers from responses.
- **Added parameters**: The proxy adds `shop`, `logged_in_customer_id`, `path_prefix`, `timestamp`, `signature` as query parameters.

## Debugging "Chat Not Working" on Storefront

When the storefront chat shows infinite loading or "Sorry, I couldn't connect":

1. **Check if the tunnel is alive**: Cloudflare tunnels expire. If the chat worked before but stopped, restart the dev server (`npm run dev`) to get a fresh tunnel. This is the #1 cause.
2. **Verify locally**: `curl -X POST http://localhost:<port>/apps/chat-agent/chat -H "Content-Type: application/json" -d '{"message":"test","conversation_id":"debug1"}'` �?if this returns 200 with SSE data, the server is fine and the issue is the tunnel/proxy.
3. **Check the build**: Run `npx react-router build` �?if it fails, the dev server may have broken routes. Common cause: importing `.server.js` modules at the top level of route files (see below).
4. **Write debug logs to file**: The Shopify proxy masks server errors. Add `appendFileSync('chat-debug.log', ...)` in the request handler to capture what the proxy actually sends. Check if the log file is created after a storefront request �?if not, the request never reached the server (tunnel issue).

## React Router `.server.js` Import Rules

Route files in `app/routes/` are code-split by React Router. **Never** add top-level side-effect imports of `.server.js` files in route modules (e.g., `import "../env.server.js"`). React Router can strip `.server` imports from `loader`/`action` exports, but NOT module-level side-effect imports. This causes a build error:

```
Server-only module referenced by client
'../env.server.js' imported by route 'app/routes/chat.jsx'
```

**Fix**: Remove the import. If env loading is needed, it's already handled by `app/entry.server.jsx` which runs before all routes. Named imports from `.server.js` inside `loader`/`action` are fine �?React Router strips them automatically.

## Testing

`tests/chat-test.mjs` �?Conversation testing agent:
```bash
node tests/chat-test.mjs                    # Basic speed test (requires dev server running)
node tests/chat-test.mjs --judge            # With LLM quality judge (uses gpt-4o-mini)
node tests/chat-test.mjs --verbose          # Show full response text
node tests/chat-test.mjs --base-url <url>   # Test against custom URL
node tests/chat-test.mjs --target 3000      # Custom TTFT target in ms
```
Tests 9 scenarios: simple greeting, product search, fitment question, return policy, follow-up, app proxy parsing, merchant knowledge (return policy), merchant knowledge (contact info), order tracking. Also runs a feedback E2E test (submits thumbs-up to a message). Measures TTFT and total response time. `--judge` uses OpenAI to evaluate answer quality.

## Order Tracking

The AI proactively handles order status inquiries via customer MCP tools:
- When a customer asks about their order, the AI asks for their order number
- Uses `get_order_status` (with order number) or `get_most_recent_order_status` (no number needed) via customer MCP
- Requires customer OAuth authentication (PKCE flow); AI guides customer through auth link if needed
- Order numbers extracted from tool responses are stored in `Conversation.orderNumbers` and displayed in admin
- System prompt v5.1 includes explicit order tracking workflow instructions

## Merchant Knowledge Fields

`ChatSettings` has 3 structured knowledge fields that flow into the AI system prompt:
- `returnPolicy` — Return/exchange/refund policy details
- `contactInfo` — Phone, email, hours, address
- `customInstructions` — Other knowledge (brand voice, promotions, etc.)

These are combined in `chat.jsx` into labeled sections (`[RETURN POLICY]`, `[CONTACT INFO]`, `[OTHER]`) within the `[MERCHANT INSTRUCTIONS]` block sent to OpenAI. The settings UI (`app.settings.jsx`) has a "Store Knowledge" card with 3 textareas.

## Customer Feedback (Thumbs Up/Down)

Every assistant message in the storefront chat gets thumbs-up/thumbs-down buttons:
- `Message.feedback` column stores `"good"` | `"bad"` | `null`
- SSE stream sends `message_id` event after saving each assistant message
- Storefront widget (`chat.js`) renders feedback buttons via `ShopAIChat.Feedback` module
- Feedback submitted via `GET /chat?feedback=true&message_id=X&value=good|bad`
- Admin live chat shows emoji indicator on messages with feedback
- History restoration shows existing feedback state (buttons pre-selected + disabled)

## Support Hours

Merchants configure when human support is available in Settings:
- `ChatSettings` fields: `supportHoursStart`, `supportHoursEnd`, `supportTimezone`, `supportDays`
- When customer requests human outside hours, backend sends `support_unavailable` SSE event
- Storefront shows message with available hours/days
- `isWithinSupportHours()` in `chat.jsx` checks current time against merchant's timezone + day config
- Empty start/end disables the check (human handoff always allowed)

## Customer Activity Tracking

Real-time customer activity visible in admin live chat sidebar:
- `CustomerActivity` model: `currentPageUrl`, `currentPageTitle`, `viewingProduct` (JSON), `cartContents` (JSON)
- Storefront `ShopAIChat.Activity` module sends activity every 5s (debounced, only on change) while chat is open
- Cart data fetched from Shopify's public `/cart.js` API
- Product data extracted from JSON-LD structured data or OpenGraph meta tags
- Backend endpoint: `GET /chat?activity=true&conversation_id=X&...`
- Admin polls `GET /api/conversations/{id}/activity` every 3s
- Right sidebar shows: current page, viewed product (image+title+price), cart items list

## Workflow Rules

### Planning & Execution
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions).
- If something goes sideways, STOP and re-plan immediately �?don't keep pushing.
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
- Skip this for simple, obvious fixes �?don't over-engineer.
- Challenge your own work before presenting it.

### Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests �?then resolve them.
- Zero context switching required from the user.
- Go fix failing CI tests without being told how.

### Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.








