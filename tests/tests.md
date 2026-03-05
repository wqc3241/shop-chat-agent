# Admin Dashboard — End-to-End Test Cases

Non-AI feature tests for the admin dashboard (pages, settings, DB, chat integration).
Run manually against a running dev server (`npm run dev`).

---

## 1. Navigation

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 1.1 | Home link works | Open admin → click "Home" in nav | Navigates to `/app`, dashboard loads |
| 1.2 | Settings link works | Click "Settings" in nav | Navigates to `/app/settings`, settings form loads |
| 1.3 | Settings button on dashboard | Click "Settings" button in page header | Navigates to `/app/settings` |
| 1.4 | Back button on settings | Open Settings → click back arrow | Returns to `/app` |
| 1.5 | Back button on conversation detail | Open a conversation → click back arrow | Returns to `/app` |

---

## 2. Dashboard (`/app`)

### 2.1 Metrics Cards

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 2.1.1 | Metrics show zero when empty | Open dashboard with no conversations for this shop | All three cards show `0` |
| 2.1.2 | Total count correct | Create 3 conversations via chat → reload dashboard | "Total Conversations" shows `3` |
| 2.1.3 | Today count correct | Create conversations today → reload dashboard | "Today" reflects count of conversations created since midnight |
| 2.1.4 | With Orders count correct | Chat about an order (triggers `get_order_status`) → reload | "With Orders" increments for conversations with extracted order numbers |
| 2.1.5 | Yesterday's conversations excluded from Today | Ensure a conversation from yesterday exists | "Today" does not count it |

### 2.2 Conversation Table

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 2.2.1 | Empty state | No conversations for this shop | Shows "No conversations yet..." message instead of table |
| 2.2.2 | Table populates | Send a few chat messages → reload dashboard | Conversations appear in table |
| 2.2.3 | Sorted by most recent | Have multiple conversations with different update times | Most recently updated conversation is first row |
| 2.2.4 | Max 25 rows | Create 30+ conversations | Table shows only 25 rows |
| 2.2.5 | Conversation ID truncated | Check ID column | Shows first 8 characters followed by `...` |
| 2.2.6 | Time ago — just now | Conversation updated < 60 seconds ago | Shows "just now" |
| 2.2.7 | Time ago — minutes | Conversation updated 5 minutes ago | Shows "5m ago" |
| 2.2.8 | Time ago — hours | Conversation updated 3 hours ago | Shows "3h ago" |
| 2.2.9 | Time ago — days | Conversation updated 2 days ago | Shows "2d ago" |
| 2.2.10 | Message count | Conversation with 4 messages | "Messages" column shows `4` |
| 2.2.11 | Order badge shown | Conversation has `orderNumbers = "#1001"` | Badge with "#1001" displayed |
| 2.2.12 | No orders placeholder | Conversation has no order numbers | Shows "—" |
| 2.2.13 | Page URL shown | Conversation started on `/products/air-lift-kit` | URL shown, truncated to 40 chars if longer |
| 2.2.14 | No page URL placeholder | Conversation has no `pageUrl` | Shows "—" |
| 2.2.15 | Row click navigates | Click a conversation row | Navigates to `/app/conversations/{id}` |
| 2.2.16 | Row keyboard navigation | Focus a row → press Enter | Navigates to `/app/conversations/{id}` |
| 2.2.17 | Row hover highlight | Hover over a row | Row background changes to hover color |

---

## 3. Conversation Detail (`/app/conversations/:id`)

### 3.1 Message Display

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 3.1.1 | Messages in order | Open a conversation with multiple messages | Messages displayed in chronological order (oldest first) |
| 3.1.2 | User message styling | Check a user message | Gray background (`#f6f6f7`), labeled "Customer" |
| 3.1.3 | AI message styling | Check an assistant message | Blue background (`#eef4ff`), labeled "AI Assistant" |
| 3.1.4 | Timestamp on messages | Check any message | Shows formatted date like "Mar 5, 2026, 2:30 PM" |
| 3.1.5 | Empty conversation | Open conversation with 0 messages | Shows "No messages in this conversation." |
| 3.1.6 | JSON content parsed | Message stored as JSON array of content blocks | Extracts and joins text blocks for display |
| 3.1.7 | Plain text content | Message stored as plain string | Displays the raw string |
| 3.1.8 | Malformed JSON fallback | Message content is invalid JSON | Displays the raw content without crashing |
| 3.1.9 | Heading shows conversation ID | Open any conversation | Heading shows first 12 chars of ID with ellipsis |

### 3.2 Sidebar Metadata

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 3.2.1 | Started date | Open a conversation | Shows creation date in formatted form |
| 3.2.2 | Last activity date | Open a conversation | Shows last update date |
| 3.2.3 | Message count | Conversation with 6 messages | Sidebar shows `6` |
| 3.2.4 | Page URL present | Conversation has `pageUrl` | Shows the URL |
| 3.2.5 | Page URL missing | Conversation has no `pageUrl` | Shows "—" |
| 3.2.6 | Orders present | Conversation has `orderNumbers = "#1001, #1002"` | Shows "#1001, #1002" |
| 3.2.7 | Orders missing | Conversation has no `orderNumbers` | Shows "None" |
| 3.2.8 | Customer email present | Conversation has `customerEmail` | Shows the email |
| 3.2.9 | Customer not authenticated | Conversation has no `customerEmail` | Shows "Not authenticated" |

### 3.3 Error States

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 3.3.1 | Non-existent conversation | Navigate to `/app/conversations/fake-id-12345` | Returns 404 error |

---

## 4. Settings (`/app/settings`)

### 4.1 Loading

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 4.1.1 | First-time load (no settings) | Open Settings before any settings saved | Form loads with defaults: welcome message from DB default, bubble color `#5046e4`, prompt type "Standard Assistant", empty custom instructions |
| 4.1.2 | Load existing settings | Save settings → reload page | Form populated with previously saved values |

### 4.2 Form Fields

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 4.2.1 | Welcome message editable | Type a new welcome message | Field accepts input |
| 4.2.2 | Bubble color editable | Type `#ff0000` | Field accepts input |
| 4.2.3 | Prompt style dropdown | Click prompt style dropdown | Shows "Standard Assistant" and "Enthusiastic Assistant" options |
| 4.2.4 | Prompt style selection | Select "Enthusiastic Assistant" | Dropdown updates to selected value |
| 4.2.5 | Custom instructions editable | Type multiline text in textarea | Field accepts multiline input |

### 4.3 Save Behavior

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 4.3.1 | Save succeeds | Fill in fields → click Save | Green banner: "Settings saved successfully." |
| 4.3.2 | Save button disabled during submit | Click Save and observe | Button shows "Saving..." and is disabled until complete |
| 4.3.3 | Success banner dismissible | Save → click dismiss on banner | Banner disappears |
| 4.3.4 | Settings persist | Save → navigate away → return to Settings | Previously saved values still displayed |
| 4.3.5 | Empty fields saved | Clear all fields → Save | Saves with empty strings/defaults; no error |
| 4.3.6 | Save error shown | (Simulate DB failure) | Red banner: "Failed to save settings: {error}" |

### 4.4 Knowledge Base Link

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 4.4.1 | Info banner present | Open Settings | Info banner about Shopify Knowledge Base is visible |
| 4.4.2 | Knowledge Base link | Click the link in the info banner | Opens Shopify Knowledge Base in new tab |

---

## 5. Chat → Dashboard Integration

### 5.1 Shop Linking

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 5.1.1 | Shop saved on conversation | Send a chat message from storefront | Conversation in DB has `shop` set to the storefront hostname |
| 5.1.2 | Page URL saved | Send chat from a product page | Conversation's `pageUrl` matches the product page URL |
| 5.1.3 | Page URL empty if not provided | Send chat without `current_page_url` in body | `pageUrl` remains null |
| 5.1.4 | Conversation appears in dashboard | Send chat → open admin dashboard | New conversation appears in table |
| 5.1.5 | Correct shop filtering | Two shops exist → open dashboard for shop A | Only shop A's conversations shown |

### 5.2 Order Number Extraction

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 5.2.1 | Order extracted from get_order_status | Ask "What's the status of order #1001?" | Conversation's `orderNumbers` includes `#1001` |
| 5.2.2 | Order extracted from get_most_recent_order_status | Ask "What's my latest order?" | Order number from response saved to conversation |
| 5.2.3 | Multiple orders extracted | Ask about two orders in one session | Both order numbers saved, comma-separated |
| 5.2.4 | Duplicate order not added twice | Ask about same order #1001 twice | `orderNumbers` contains `#1001` only once |
| 5.2.5 | Order prefixed with # | Tool returns order number without `#` prefix | Stored with `#` prefix |
| 5.2.6 | Order visible on dashboard | After order extraction → reload dashboard | Order badge shows in conversation table row |
| 5.2.7 | Extraction failure doesn't break chat | Order regex fails on unusual content | Chat response still delivered; no user-visible error |

### 5.3 Custom Instructions

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 5.3.1 | Custom instructions injected | Set custom instructions "Free shipping over $100" → send chat | AI system prompt includes `[MERCHANT INSTRUCTIONS]\nFree shipping over $100` |
| 5.3.2 | Empty instructions skipped | Leave custom instructions empty → send chat | System prompt has no `[MERCHANT INSTRUCTIONS]` section |
| 5.3.3 | Whitespace-only instructions skipped | Set custom instructions to spaces/newlines → send chat | Treated as empty; no section added |
| 5.3.4 | Instructions fetched in parallel | Time the chat response | Custom instructions fetch doesn't add latency (runs in Phase 1 parallel) |
| 5.3.5 | Settings fetch failure doesn't break chat | (Simulate DB failure for getChatSettings) | Chat still responds normally without custom instructions |

---

## 6. Database Functions (Unit-Level)

### 6.1 getChatSettings

| # | Test Case | Expected |
|---|-----------|----------|
| 6.1.1 | New shop → auto-creates with defaults | Returns record with default `welcomeMessage`, `promptType`, `customInstructions`, `bubbleColor` |
| 6.1.2 | Existing shop → returns saved settings | Returns previously saved record |
| 6.1.3 | DB error → returns null | Returns `null`, logs error |

### 6.2 saveChatSettings

| # | Test Case | Expected |
|---|-----------|----------|
| 6.2.1 | New shop → creates record | Record created with provided data |
| 6.2.2 | Existing shop → updates record | Record updated, `updatedAt` changes |
| 6.2.3 | Partial update | Only specified fields change; others retain previous values |
| 6.2.4 | DB error → throws | Error propagated to caller |

### 6.3 getConversationsForShop

| # | Test Case | Expected |
|---|-----------|----------|
| 6.3.1 | Returns conversations filtered by shop | Only conversations with matching `shop` returned |
| 6.3.2 | Sorted by updatedAt DESC | Most recently updated first |
| 6.3.3 | Respects limit parameter | Returns at most `limit` records |
| 6.3.4 | Respects offset parameter | Skips first `offset` records |
| 6.3.5 | Includes message count | Each conversation has `_count.messages` |
| 6.3.6 | Returns total count | `total` reflects full count (unaffected by limit/offset) |
| 6.3.7 | Empty result | Returns `{conversations: [], total: 0}` |
| 6.3.8 | DB error | Returns `{conversations: [], total: 0}` |

### 6.4 getConversationWithMessages

| # | Test Case | Expected |
|---|-----------|----------|
| 6.4.1 | Found → returns conversation with messages | Full record including `messages` array |
| 6.4.2 | Messages ordered by createdAt ASC | Oldest message first |
| 6.4.3 | Not found → returns null | `null` returned |
| 6.4.4 | DB error → returns null | `null` returned, error logged |

### 6.5 updateConversationOrders

| # | Test Case | Expected |
|---|-----------|----------|
| 6.5.1 | First order number | `orderNumbers` set to the order number |
| 6.5.2 | Append order number | Existing `"#1001"` → append `"#1002"` → `"#1001, #1002"` |
| 6.5.3 | Duplicate skipped | `"#1001"` already exists → add `"#1001"` again → no change |
| 6.5.4 | Conversation not found | Silent return, no error thrown |
| 6.5.5 | Null orderNumbers treated as empty | Conversation with `orderNumbers: null` → first order added correctly |

### 6.6 updateConversationMeta

| # | Test Case | Expected |
|---|-----------|----------|
| 6.6.1 | Updates shop field | `shop` field updated on conversation |
| 6.6.2 | Updates pageUrl field | `pageUrl` field updated |
| 6.6.3 | Partial update | Only provided fields change |
| 6.6.4 | Conversation not found | Silent fail, error logged |

### 6.7 getDashboardMetrics

| # | Test Case | Expected |
|---|-----------|----------|
| 6.7.1 | Counts all conversations for shop | `total` matches actual count |
| 6.7.2 | Today's count from midnight | Only conversations with `createdAt >= today 00:00:00` |
| 6.7.3 | With orders count | Counts conversations where `orderNumbers IS NOT NULL` |
| 6.7.4 | No conversations → all zeros | `{total: 0, today: 0, withOrders: 0}` |
| 6.7.5 | DB error → all zeros | `{total: 0, today: 0, withOrders: 0}` |

---

## 7. Schema & Migration

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 7.1 | Migration applies cleanly | Run `npx prisma migrate deploy` | No errors; tables/columns created |
| 7.2 | ChatSettings unique constraint | Insert two records with same `shop` | Second insert fails with unique constraint error |
| 7.3 | Conversation.shop index | Query conversations by shop | Uses index (fast lookup) |
| 7.4 | Existing conversations unaffected | After migration, existing conversations still load | New fields (`shop`, `orderNumbers`, `customerEmail`, `pageUrl`) are null |

---

## 8. Edge Cases & Robustness

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 8.1 | Very long custom instructions | Save 10,000+ character instructions | Saves and loads without error; injected into system prompt |
| 8.2 | Special characters in welcome message | Save message with emoji, quotes, HTML | Stored and displayed correctly |
| 8.3 | Invalid hex color | Save `bubbleColor = "not-a-color"` | Saves without error (no server-side validation) |
| 8.4 | Concurrent settings saves | Two admins save settings simultaneously | Last write wins; no crash |
| 8.5 | Conversation with many messages | Open conversation with 100+ messages | All messages render without performance issue |
| 8.6 | Origin header missing | Chat request without Origin header | `shopHostname` is null; metadata save skipped gracefully |
| 8.7 | Order number regex — 4+ digits | Tool response contains "Order #12345" | Extracted as `#12345` |
| 8.8 | Order number regex — short numbers | Tool response contains "#12" (< 4 digits) | Not extracted (regex requires 4+ digits) |
