# Lessons Learned

## 2026-03-15: Must use OpenAI Codex for code generation (Rule 8)
**Mistake**: Wrote code changes directly instead of using OpenAI Codex via the API.
**Rule**: ALL code changes must be generated via OpenAI API (gpt-4o or o3-mini), reviewed, then applied. Never write code directly.
**Prevention**: Before touching any source file, check: "Am I about to write code? If yes, route through Codex first."

## 2026-03-15: gpt-5.3-codex uses Responses API, not Chat Completions
**Mistake**: Tried `client.chat.completions.create()` with `gpt-5.3-codex` — got 404 "not a chat model".
**Rule**: Codex models use `client.responses.create()` (Responses API), not chat completions.
**Prevention**: For codex models, always use `client.responses.create({ model, input })`.

## 2026-03-15: Review Codex output for date format bugs
**Mistake**: Codex generated override dates as `10/10/2023` instead of `2023-10-10` (YYYY-MM-DD) which is what `Intl.DateTimeFormat('en-CA')` produces.
**Rule**: Always review Codex output before applying — especially data format assumptions.
**Prevention**: Cross-check generated test fixtures against the actual code's format expectations.
