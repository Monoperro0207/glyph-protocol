---
'@glyphp/server': minor
---

Pluggable `ConfirmationStore` and `RateLimitStore` for multi-replica
deployments. By default both stay in-memory (existing behavior, per process).
Injecting shared-storage implementations via the new `confirmationStore` /
`rateLimitStore` server options makes a confirmation ticket issued by one
replica consumable on another, and the rate limit global instead of per
process. `MemoryConfirmationStore` / `MemoryRateLimitStore` are exported, and
`docs/deployment.md` gains a Redis example.
