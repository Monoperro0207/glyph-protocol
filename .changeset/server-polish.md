---
'@glyphp/server': minor
---

Production polish from the external audit's minor findings:

- `/health` and the handshake now report the real package version (was
  hardcoded `0.1.0`).
- Injectable `logger` option (`GlyphLogger`: info/warn/error, defaults to
  `console`) — all operational output, including the startup publicKey
  notice, goes through it.
- Opt-in idempotency via `dedupeByClientCallId`: a retried call carrying the
  same client `callId` and identical input replays the recorded response
  instead of re-executing the handler. Keyed on
  `glyph + callId + inputHash`, default TTL 5 minutes, pluggable
  `DedupeStore` (with `MemoryDedupeStore` default) for multi-replica
  deployments.
