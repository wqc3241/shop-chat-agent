# TODO

- [ ] Add an automated storefront client test for the request-human SSE path so blank assistant bubbles cannot regress.
- [ ] Add an automated test for polling/history rendering to ensure `tool_use` and `tool_result` payloads are never shown in storefront chat.
- [ ] Verify the fitment source footnote styling in the storefront UI and decide whether it should be visually muted.
- [ ] Verify OpenAI-backed `web_search` behavior in a fully working local Shopify runtime once `SHOPIFY_APP_URL` and `SHOPIFY_API_SECRET` are available.
- [ ] Add a timeout/fallback test for `web_search` so slow external search does not stall fitment answers.
- [ ] Re-run the live chat smoke test against a working local or tunneled endpoint after the Shopify runtime env is fixed.
- [ ] Consider deduping repeated assistant acknowledgements in storefront polling if duplicate saved text appears in real conversations.
