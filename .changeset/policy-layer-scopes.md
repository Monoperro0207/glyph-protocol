---
'@glyphp/types': minor
'@glyphp/core': minor
'@glyphp/server': minor
---

Add an optional scope-based policy layer (RFC-0002).

- `GlyphCard.requiredScopes?: string[]` is now part of the canonical card
  content, so a change to it produces a new card id and forces consumer
  re-approval.
- `defineGlyph({ requiredScopes })` declares the scopes the caller must
  carry. An empty/omitted list keeps the previous open-to-any-caller
  behaviour.
- `new GlyphServer({ policy })` accepts a `PolicyResolver` that maps each
  request to a `CallerPrincipal` carrying scopes and an optional tenant.
- A scoped glyph called without the required scopes (or without a
  configured resolver) returns `403 INSUFFICIENT_SCOPE` with the missing
  scopes echoed under `details.missing`.

Backwards compatible: glyphs that don't declare `requiredScopes` keep their
previous id and behaviour. See `spec/rfcs/RFC-0002-policy-layer.md`.
