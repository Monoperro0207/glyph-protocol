---
"@glyphp/client": minor
---

Add `GlyphClient.production(options)` — a factory that constructs a client with
the recommended hardened posture so the safe configuration is the easy path:
`secureMode: true`, `verifyReceipts: true`, `autoApproveReviewChanges: false`,
and `tofu: false`. A `PinStore` is required (the factory throws if it is
missing, rather than silently degrading). Every default remains overridable by
the caller; provider trust and `requireAttestation` are left to the operator
since they need an injected resolver/verifier.
