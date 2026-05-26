---
"@glyphp/server": minor
---

Add `strictProduction` option to `GlyphServerOptions`. When `NODE_ENV=production` and `strictProduction: true` (the default in production), the constructor throws if auth, rateLimit, or a stable keyPair/signer are missing. When `strictProduction: false`, only a warning is logged. Non-production environments are unaffected. Update `glyph init production-server` scaffold to include `strictProduction: true`.
