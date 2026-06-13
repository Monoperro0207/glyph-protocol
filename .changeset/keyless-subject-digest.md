---
'@glyphp/core': minor
---

Fix RFC-0007 §3.1.1: bind the keyless `subjectDigest` to the card's
**attestation-exclusive** canonical id (new exported `keylessSubjectDigest()`)
instead of `sha256(card.id)`. The bundle rides inside `card.attestation`,
which itself enters `card.id`, so the original binding was an unsatisfiable
fixed point — no keyless-attested card could pass both `verifyGlyph()` and
keyless verification at once. `KeylessVerifier.verify` now recomputes the
digest from the received card's content, never from `card.id` (whose own
integrity stays `verifyGlyph`'s §3.2 check). For a card without an
attestation the digest still equals `sha256(card.id)`.
