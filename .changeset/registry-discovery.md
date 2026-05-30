---
"@glyphp/types": minor
"@glyphp/core": minor
"@glyphp/client": minor
---

Implement RFC-0003 public providers registry discovery. Adds the
`PublicProvidersRegistry` / `RegistryProvider` types, `signProvidersRegistry()`
+ `verifyProvidersRegistry()` in core, and `GlyphClient.discoverProviders(url, {
trustRoot })`. The client fetches a signed provider directory from any URL and
returns it only when its signature verifies against the `trustRoot` the
consumer pinned out of band. The registry is a directory, not a name authority:
`discoverProviders()` never approves a glyph — approval still requires the pin
store and the normal `diffCards` flow on first `getCard()` per provider.
