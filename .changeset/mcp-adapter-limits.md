---
"@glyphp/adapter-mcp": minor
---

Add opt-in hardening limits for importing tools from an untrusted MCP server:

- `maxTools` — cap the number of imported tools; throws (rather than silently
  truncating) when a server advertises more, bounding the agent's tool surface.
- `redactDescriptions` — keep attacker-controlled tool descriptions out of
  `card.intent`, so a server cannot smuggle instructions or secrets into a card
  a human reviews.
- `sanitizeErrors` — surface a generic tool-failure message instead of echoing
  upstream error text that may carry secrets or injected content.
- `listToolsTimeoutMs` — bound the `listTools()` call in `glyphsFromMcpClient`
  so a hung or slow server cannot stall import.

All four are opt-in and default to the previous behavior, so existing callers
are unaffected.
