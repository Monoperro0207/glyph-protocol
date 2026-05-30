---
"@glyphp/client": minor
---

Add opt-in `tofu` (trust-on-first-use) to `GlyphClient`. When enabled, a
never-seen tool is auto-pinned on its first call — after its signature
verifies — instead of throwing `GlyphNotApprovedError`, so an agent doesn't
need an explicit `approveCard()` for every new tool. Only the first encounter
is relaxed: once pinned, a later card change (key swap, schema, risk
escalation) is gated by the pin exactly as without TOFU, and a card whose
signature does not verify is never pinned. Defaults to `false` — existing
behavior unchanged. Requires a PinStore.
