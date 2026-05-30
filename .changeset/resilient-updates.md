---
"@glyphp/client": minor
---

Add opt-in `resilientUpdates` mode to `GlyphClient`. When enabled, a tool whose
card changed since approval is no longer rejected with `GlyphNotApprovedError`:
the new card is parked in a `PendingAuditQueue` for later audit while `call()`
keeps running the last approved (stable) pin — fail-to-last-known-good instead
of fail-closed. A never-pinned tool still throws (no stable version to fall back
to), and under `secureMode` the receipt is verified against the stable pin so a
server that actually swapped to the unaudited card has its output rejected.

New exports: `PendingAuditQueue`, `PendingAuditEntry`, `MemoryPendingAuditQueue`,
and `GlyphClient.pendingAudits()`. Defaults to `false` — existing behavior is
unchanged.
