---
"@glyphp/client": minor
---

Add `GlyphClient.auditPending()` and the `AuditReport` type. This read-only
primitive re-verifies every parked tool update in the `PendingAuditQueue`: the
new card's signature and content hash, any signed update manifest (must verify
and describe this exact update), and any attestation (run through the registered
verifiers). It returns one `AuditReport` per entry and never promotes an update
or drains the queue — promotion is a separate, policy-gated decision.
