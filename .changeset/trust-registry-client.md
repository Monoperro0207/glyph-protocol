---
"@glyphp/client": minor
---

Add ProviderTrustResolver for provider trust discovery (HTTP, filesystem, explicit entries) with genesis key pinning (TRUSTREG-001/003). Add provider trust enforcement to GlyphClient via `trust` option: unknown providers are rejected, untrusted signing keys are blocked (TRUSTREG-002). Export GlyphTrustError and TrustConfig.
