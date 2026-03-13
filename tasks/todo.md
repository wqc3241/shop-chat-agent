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

## Existing Items

- [ ] Add an automated storefront client test for the request-human SSE path so blank assistant bubbles cannot regress.
- [ ] Add an automated test for polling/history rendering to ensure `tool_use` and `tool_result` payloads are never shown in storefront chat.
- [ ] Verify the fitment source footnote styling in the storefront UI and decide whether it should be visually muted.
- [ ] Verify OpenAI-backed `web_search` behavior in a fully working local Shopify runtime once `SHOPIFY_APP_URL` and `SHOPIFY_API_SECRET` are available.
- [ ] Add a timeout/fallback test for `web_search` so slow external search does not stall fitment answers.
- [ ] Re-run the live chat smoke test against a working local or tunneled endpoint after the Shopify runtime env is fixed.
- [ ] Consider deduping repeated assistant acknowledgements in storefront polling if duplicate saved text appears in real conversations.
