# TODO

## Feature 1: Customer Feedback on AI Responses (thumbs up/down) - DONE
- [x] Add `feedback` column to `Message` model in schema.prisma
- [x] Create migration SQL
- [x] Add `updateMessageFeedback()` to db.server.js
- [x] Add `?feedback=true` handler in chat.jsx
- [x] Add feedback buttons to storefront chat widget (chat.js)
- [x] Add feedback button CSS (chat.css)
- [x] Show feedback indicators in admin live chat (app.live-chat.jsx)
- [x] Add feedback test case to chat-test.mjs
- [x] Update CLAUDE.md

## Feature 2: Support Hours Setting - DONE
- [x] Add support hours fields to ChatSettings in schema.prisma
- [x] Create migration SQL
- [x] Add "Support Hours" card in app.settings.jsx
- [x] Check business hours in chat.jsx before allowing human handoff
- [x] Expose support hours to storefront widget (support_unavailable SSE event)
- [x] Update CLAUDE.md

## Feature 3: Real-Time Customer Activity Tracking - DONE
- [x] Add CustomerActivity model to schema.prisma
- [x] Create migration SQL
- [x] Add DB functions for activity upsert/get
- [x] Add activity tracker to storefront chat widget
- [x] Add activity endpoint handler in chat.jsx
- [x] Add admin API route for activity polling
- [x] Render activity in live chat right sidebar
- [x] Update CLAUDE.md

## App Store Submission — Remaining Steps

### After restart: PostgreSQL + Migration - DONE
- [x] Install Docker Desktop OR PostgreSQL on Windows
- [x] Start PostgreSQL: `docker run -d --name shop-chat-pg -p 5432:5432 -e POSTGRES_DB=shop_chat_agent -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=postgres postgres:16`
- [x] Verify `.env` has `DATABASE_URL=postgresql://postgres:dev@localhost:5432/shop_chat_agent`
- [x] Apply migration: `npx prisma migrate deploy && npx prisma generate`
- [x] Build passes: `npm run build`
- [x] Fixed GDPR webhooks: `topics` → `compliance_topics` in toml
- [x] Verify dev server works: `npm run dev` ✓ running on localhost:59626

### Deploy to Fly.io - DONE
- [x] Install flyctl
- [x] `fly auth login`
- [x] `fly apps create nlp-shop-chat-agent`
- [x] `fly postgres create --name nlp-shop-chat-agent-db --region iad`
- [x] `fly postgres attach nlp-shop-chat-agent-db`
- [x] `fly secrets set` (SHOPIFY_API_KEY, SHOPIFY_API_SECRET, OPENAI_API_KEY, SHOPIFY_APP_URL)
- [x] Fixed: Dockerfile node:18→node:20, npm ci --legacy-peer-deps, HOST=0.0.0.0
- [x] `fly deploy` ✓ https://nlp-shop-chat-agent.fly.dev
- [x] Health check passes: `{"status":"ok"}`

### Update Production URLs - DONE
- [x] Updated `shopify.app.shop-chat-agent.toml` — all URLs → `https://nlp-shop-chat-agent.fly.dev`
- [x] `shopify app deploy` → version shop-chat-agent-4 released

### App Listing Assets
- [ ] App icon: 1200x1200 PNG (manual — design needed)
- [ ] 2+ screenshots at 1600x900 (manual — capture settings page, chat widget, live chat admin)
- [x] App description + tagline drafted → `tasks/app-listing.md`
- [x] Privacy policy URL: `https://nlp-shop-chat-agent.fly.dev/privacy`
- [x] Add credit card to Fly.io — machines now stay running
- [ ] Submit in Shopify Partners Dashboard → App listing

### Optional: Billing (skip if launching free)
- [ ] Decide: free vs paid
- [ ] If paid: implement `app/services/billing.server.js` with `ensureActiveSubscription()`

### What's Already Done
- [x] SQLite → PostgreSQL schema migration (`prisma/schema.prisma`)
- [x] Initial PostgreSQL migration SQL (`prisma/migrations/0_init/`)
- [x] GDPR webhook handlers (`CUSTOMERS_DATA_REQUEST`, `CUSTOMERS_REDACT`, `SHOP_REDACT`)
- [x] GDPR webhook subscriptions in `shopify.app.shop-chat-agent.toml`
- [x] Data retention cleanup (90-day, `cleanup.server.js` wired into app loader)
- [x] `.env.example` created
- [x] `.gitignore` updated (`.env.example` exception)
- [x] Dockerfile updated (postgresql-client)
- [x] `fly.toml` created
- [x] Deploy script (`scripts/deploy-fly.sh`)
- [x] Privacy policy page (`/privacy` route)
- [x] `chat.jsx` build error fixed (dynamic imports for server modules)
- [x] Removed unused `storeHandle` from `app.settings.jsx`
- [x] Updated `webhooks_path` in `shopify.web.toml`
- [x] Build passes (`npm run build` succeeds)

---

## Existing Items

- [ ] Add an automated storefront client test for the request-human SSE path so blank assistant bubbles cannot regress.
- [ ] Add an automated test for polling/history rendering to ensure `tool_use` and `tool_result` payloads are never shown in storefront chat.
- [ ] Verify the fitment source footnote styling in the storefront UI and decide whether it should be visually muted.
- [ ] Verify OpenAI-backed `web_search` behavior in a fully working local Shopify runtime once `SHOPIFY_APP_URL` and `SHOPIFY_API_SECRET` are available.
- [ ] Add a timeout/fallback test for `web_search` so slow external search does not stall fitment answers.
- [ ] Re-run the live chat smoke test against a working local or tunneled endpoint after the Shopify runtime env is fixed.
- [ ] Consider deduping repeated assistant acknowledgements in storefront polling if duplicate saved text appears in real conversations.
