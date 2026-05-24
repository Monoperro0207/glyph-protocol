---
'@glyphp/integration-vercel-ai': major
'@glyphp/integration-langchain': major
'@glyphp/integration-llamaindex': major
'@glyphp/integration-openai-agents': major
---

**Breaking + Safety fix.** Two changes to all four framework integrations
(Vercel AI, LangChain, LlamaIndex, OpenAI Agents):

1. **Real input schemas.** `glyphsAs*Tools(client)` now fetches each glyph's
   `rich` card and uses `card.input` as the tool's parameter schema, so the
   LLM gets the real JSON Schema instead of `{}`. The synchronous helper
   `fromLexicon(...)` still emits empty schemas (low-fidelity, opt-in).

2. **`onConfirmation` is now strictly boolean.** The hook signature was
   `Promise<string | undefined>` and treated any truthy value as approval —
   so a hook that returned the string `"reject"` accidentally authorized
   the call. The hook is now `Promise<boolean>`; only the literal `true`
   authorizes. Any other value (including `false`, `undefined`, non-boolean,
   or a thrown error) re-raises the original `CONFIRMATION_REQUIRED`. The
   hook also now receives the bound `confirmationToken` so it can be
   forwarded to a human approver out-of-band.

Migration: change `onConfirmation` implementations from
`return "approved"` / `return undefined` to `return true` / `return false`.
