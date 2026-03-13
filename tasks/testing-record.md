# Testing Record — Handle Resolution & Product URL Fixes

## Date: 2026-03-12

## Commit History (this session)
- `b05ba23` — Improve AI product response quality and prevent URL fabrication
- `05c6950` — Add Admin API handle resolution for real product URLs
- (pending) — Improve judge test accuracy and update test scenarios

---

## Changes Made

### 1. handle-resolver.server.js (NEW)
- Resolves Shopify product GIDs to handles via Admin GraphQL API `nodes` query
- In-memory `Map<string, string>` cache (GID → handle) avoids repeated lookups
- Graceful fallback: if Admin API fails, products just won't have URLs

### 2. tool.server.js (MODIFIED)
- `createToolService` now accepts `shopHostname` parameter
- After product search results are processed, calls `resolveHandlesForProducts` to batch-fetch handles
- Replaced JSON `formattedProducts` with pre-formatted markdown text for AI context
  - Products with URLs: `[title](url)` markdown links
  - Products without URLs: `**title**` bold text only
  - Instruction appended: "Do NOT add links to products that don't have links above"
- New `resolveHandlesForProducts` method exposed on the service object
- Removed raw `_raw` field, `images`, `variants`, `specifications` from AI-facing product data

### 3. chat.jsx (MODIFIED)
- `createToolService` moved after `shopHostname` derivation, now passes both `storeDomain` and `shopHostname`
- `shouldShowProductCards` changed from `const` to `let`, set to `true` when AI tool calls return products
- Added handle resolution for proactive (explicit) product searches with guard for test mocks

### 4. shopify.app.shop-chat-agent.toml (MODIFIED, gitignored)
- Added `read_products` to access scopes

### 5. prompts.json (MODIFIED in previous commit)
- System prompt v5.0: added relevance filtering, tool usage on follow-ups, brevity, store policy guidance, no-fabricated-link rules

### 6. chat-test.mjs (MODIFIED)
- Updated product search test from "brake pads" (not in catalog) to "coilovers" (in catalog)
- Judge now receives product card data alongside text response for accurate evaluation
- Judge system prompt updated to count product cards as part of the answer

---

## Test Results

### Unit Tests (vitest)
- **Result: 124/124 PASS**
- All 15 test files pass
- No regressions from handle resolution changes
- Guard check (`toolService.resolveHandlesForProducts &&`) prevents test failures where mock doesn't include the new method

### Handle Resolution Verification

#### Before `read_products` scope (scope denied)
- Admin API returned: `Access denied for Product object. Required access: read_products access scope.`
- Products had `handle: null`, `url: ""`
- Graceful fallback worked — no crashes, products just showed without links

#### After `read_products` scope (scope auto-granted on dev restart)
- Admin API successfully resolves GIDs to handles
- Example: `gid://shopify/Product/7987117392048` → `air-lift-performance-18-23-lexus-is300-17-23-lexus-is350-coilover-kit`
- Product URLs correctly built: `https://dev-nlp-brochure.myshopify.com/products/<handle>`
- In-memory cache working (subsequent requests for same products skip API call)

### Judge Agent Results

#### Run 1: Before fixes (baseline)
- **Score: ~5.6/10** (2-3 of 6 tests passing)
- Primary issues: fabricated URLs, no product cards for AI searches, verbose responses

#### Run 2: After handle resolution + scope fix (first run)
- **Score: 4/6 tests pass**
- Product search failed (judge couldn't see product cards, "brake pads" not in catalog)
- Fitment incorrectly confirmed (AI reasoning error with gpt-4o-mini)

#### Run 3: After judge improvements (final run)
- **Score: 5/6 tests pass** ✅

| Test | TTFT | Total | Chars | Speed | Concise | Quality |
|------|------|-------|-------|-------|---------|---------|
| Simple greeting | 958ms | 1546ms | 183 | PASS | PASS | PASS |
| Product search | 456ms | 456ms | 67 | PASS | PASS | PASS |
| Fitment question | 957ms | 4302ms | 562 | PASS | PASS | PASS |
| Return policy | 3474ms | 4120ms | 179 | **FAIL** | PASS | PASS |
| Follow-up question | 582ms | 1406ms | 199 | PASS | PASS | PASS |
| Form-encoded parsing | 558ms | 1066ms | 154 | PASS | PASS | PASS |

**Average TTFT: 1164ms** (target: 2000ms)
**Average total response time: 2149ms**

### Remaining Issue
- **Return policy TTFT (3474ms):** The AI makes 2 MCP tool calls (`search_shop_policies_and_faqs`) before responding. The tool call round-trip adds ~1.5s each, pushing TTFT over the 2000ms target. This is a structural latency issue with the MCP policy tool, not a code bug.

---

## Key Findings

1. **Shopify Storefront MCP does not return product handles or URLs** — only GIDs. This was the root blocker for product links.
2. **Admin API `nodes` query** is the correct way to resolve GIDs → handles. Requires `read_products` scope.
3. **Pre-formatted text approach** effectively prevents AI URL fabrication — the AI can only link products that have resolved URLs.
4. **Product card visibility** for AI tool-call searches required `shouldShowProductCards` to be mutable.
5. **Judge accuracy** improved by including product card data in evaluation context.

## Next Steps
- [x] Restart dev server with `read_products` scope
- [x] Verify handle resolution works end-to-end
- [x] Re-run judge agent: `node tests/chat-test.mjs --judge`
- [ ] Push commits to remote
- [ ] Investigate return policy TTFT (consider caching policy responses or skipping tool call for generic policy questions)
