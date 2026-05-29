---
"@glyphp/client": minor
---

Add the autonomous audit layer to `GlyphClient`. A new `AutoPromotionPolicy`
plus `processAudits()` and a background runner (`startAuditRunner()` /
`stopAuditRunner()` / `flushAudits()`) let the client audit parked tool updates
on its own and re-pin (promote) the ones that pass — without blocking the live
workflow, which keeps running on the stable pin.

Promotion is policy-gated and conservative by default (an unset policy promotes
nothing). Each flag opens one change class: `allowBreaking`, `allowRiskEscalation`,
`allowKeyChange`, `requireManifest`, `requireAttestation`. A failed audit is never
promotable regardless of policy, and only the exact audited card is promoted —
never a revoked tool. New exports: `AutoPromotionPolicy`, `AuditDecision`,
`evaluatePromotion`, and `onAuditComplete`.
