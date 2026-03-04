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

**Request flow:**
1. Chat bubble (`extensions/chat-bubble/assets/chat.js`) sends POST to `/chat` endpoint
2. `app/routes/chat.jsx` receives the request, loads conversation history from SQLite
3. MCP client (`app/mcp-client.js`) connects to Shopify's customer & storefront MCP servers, lists available tools
4. OpenAI service (`app/services/openai.server.js`) converts MCP tools to OpenAI function-calling format and streams a completion
5. When OpenAI returns tool calls, they're executed via MCP, results fed back, and the loop continues until a final text response
6. Response is streamed back to the client via SSE; messages are persisted to the database

**Key services in `app/services/`:**
- `openai.server.js` — OpenAI client creation, MCP→OpenAI tool conversion, streaming completions, tool use handling
- `tool.server.js` — Tool response processing, product search result formatting, conversation history management
- `streaming.server.js` — SSE StreamManager with backpressure handling
- `websearch.server.js` — DuckDuckGo web search integration (no API key needed)
- `config.server.js` — Centralized config (model name, max tokens, prompt type, tool settings)

**Other key files:**
- `app/mcp-client.js` — MCP protocol client; connects to customer MCP (authenticated) and storefront MCP (public), handles JSON-RPC
- `app/db.server.js` — Prisma database operations (sessions, conversations, messages, customer tokens, PKCE code verifiers)
- `app/auth.server.js` — OAuth 2.0 + PKCE flow for customer account access
- `app/prompts/prompts.json` — System prompts (two variants: `standardAssistant` and `enthusiasticAssistant`)

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

## No Test Suite

There is currently no test framework configured in this project.

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
