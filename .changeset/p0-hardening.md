---
"@glyphp/client": minor
"@glyphp/server": minor
---

P0 hardening from the external audit.

`@glyphp/client` — `GlyphClient` now accepts `authToken`, `headers` and a
`fetch` override in its constructor, so it can talk to a server with bearer-token
auth enabled (previously impossible with the official client). Glyph names are
now percent-encoded into request paths.

`@glyphp/server` — the rate limiter can no longer be bypassed by rotating fake
bearer tokens: a token only earns its own bucket once it is verified, otherwise
the request is keyed by IP. A malformed JSON request body now returns a
`400 MALFORMED_JSON` `GlyphError` instead of an unhandled `500`. `register()`
throws instead of silently overwriting when a glyph name is already registered.
