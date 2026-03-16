# Shop Chat Agent

A Shopify app that embeds an AI-powered chat widget on storefronts. Shoppers can search products, ask about policies, manage carts, track orders, and initiate returns — all via natural language. The backend uses OpenAI with Shopify's [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) for tool invocation.

## Features

- **Natural-language product discovery** — search, filter, and get recommendations via chat
- **Conversational shopping assistant** — asks clarifying questions for vague requests, searches immediately for specific ones
- **Store policy & FAQ lookup** — auto-synced from Shopify admin, queried via MCP at runtime
- **Cart management** — add/remove items, view cart, initiate checkout
- **Order tracking & returns** — look up order status, initiate returns
- **Live chat (merchant takeover)** — merchants can take over conversations from AI in real-time
- **Customer activity tracking** — see what page customers are on, what's in their cart, product they're viewing
- **Fitment/compatibility answers** — auto-searches product data on product pages for fitment questions
- **Web search** — OpenAI-backed web search for questions outside store knowledge
- **Natural language support hours** — merchants describe hours in plain text, parsed by AI
- **Customer feedback** — thumbs up/down on AI responses
- **Tiered billing** — 4 plans gating AI conversation volume (human chat always unlimited)

## Billing Tiers

| | Free | Starter ($19/mo) | Pro ($49/mo) | Enterprise |
|---|---|---|---|---|
| AI conversations/month | 25 | 100 | 300 | Custom |
| Human/merchant chat | Unlimited | Unlimited | Unlimited | Unlimited |
| All features | Yes | Yes | Yes | Yes |
| Trial | — | 14 days | 14 days | — |

When AI quota is exhausted, conversations are routed to the merchant's live chat queue. Customers see: "We have notified the merchant. Someone will be with you shortly."

## Architecture

### Components

1. **Backend (React Router server)** — handles chat messages, streams responses via SSE, orchestrates OpenAI + MCP tool calls, enforces billing quotas
2. **Chat UI (Shopify theme extension)** — `extensions/chat-bubble/` provides the storefront-facing chat widget
3. **Admin UI** — settings, live chat, billing management, conversation history

### Request Flow

1. Chat bubble sends POST to `/chat` endpoint
2. **Phase 1 (parallel):** Customer account URLs, storefront MCP connection, conversation history, and chat settings fetched concurrently
3. **Billing check:** New conversations checked against tier quota — over limit routes to merchant
4. **Phase 2 (parallel):** Customer MCP connection and fitment auto-search run concurrently
5. OpenAI streams a completion with MCP tools; tool calls loop until final text response
6. Response streamed back via SSE; messages persisted to database

### Tech Stack

- **Framework**: [React Router](https://reactrouter.com/) v7
- **AI**: [OpenAI](https://www.openai.com) (GPT-4o for chat, GPT-4o-mini for schedule parsing/judging)
- **Shopify**: [@shopify/shopify-app-react-router](https://www.npmjs.com/package/@shopify/shopify-app-react-router) v12
- **Database**: PostgreSQL via [Prisma](https://www.prisma.io/)
- **Hosting**: [Fly.io](https://fly.io)

### Key Services

| File | Purpose |
|------|---------|
| `app/services/openai.server.js` | OpenAI client, MCP→OpenAI tool conversion, streaming |
| `app/services/tool.server.js` | Tool response processing, product formatting |
| `app/services/streaming.server.js` | SSE StreamManager with backpressure |
| `app/services/billing-config.server.js` | Tier definitions and helpers |
| `app/services/intent.server.js` | Zero-latency intent classification (regex) |
| `app/services/websearch.server.js` | OpenAI web search (Responses API) |
| `app/services/schedule-parser.server.js` | NL → JSON schedule parser |
| `app/mcp-client.js` | MCP protocol client (storefront + customer) |
| `app/db.server.js` | All Prisma database operations |

## Development

```bash
npm run dev              # Start dev server (Shopify CLI handles tunneling)
npm run build            # Production build
npm run setup            # Generate Prisma client + run migrations
npm run lint             # ESLint
npm run typecheck        # Type checking
```

### Environment Variables

Required in `.env`:
- `OPENAI_API_KEY` — OpenAI API key
- `SHOPIFY_API_KEY` — Shopify app API key
- `DATABASE_URL` — PostgreSQL connection string

### Database

```bash
npx prisma generate          # Regenerate client after schema changes
npx prisma migrate dev       # Create new migration
npx prisma migrate deploy    # Apply migrations
```

## Testing

```bash
node tests/chat-test.mjs                         # Basic speed test
node tests/chat-test.mjs --judge                  # With LLM quality judge
node tests/chat-test.mjs --verbose                # Show full response text
node tests/chat-test.mjs --base-url <url>         # Test against custom URL
```

**Test coverage:** greeting, product search, fitment, policies, follow-up, conversational shopping, keyword extraction, order tracking, support hours (6 E2E scenarios with per-test DB config), billing quota (6 tests), feedback, activity tracking, conversation persistence, MCP tool accessibility.

## Deployment

```bash
# Deploy to Fly.io
fly deploy --app nlp-shop-chat-agent

# Deploy Shopify app config (webhooks, scopes, etc.)
npx shopify app deploy --allow-updates
```

- **Production URL**: https://nlp-shop-chat-agent.fly.dev
- **Health check**: `GET /health`
- Startup runs `prisma migrate deploy` automatically

## Shopify App Config

- **Config file**: `shopify.app.shop-chat-agent.toml`
- **Org**: Next Level Performance (129937154)
- **Dev store**: `dev-nlp-brochure-2.myshopify.com`
- **Webhooks**: GDPR compliance (`customers/data_request`, `customers/redact`, `shop/redact`) + billing (`app_subscriptions/update`)
