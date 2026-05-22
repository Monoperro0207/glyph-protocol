# @glyphp/core

The cryptographic and content-addressing core of the Glyph Protocol —
hashing, ed25519 signing, validation, and signed call receipts.

```typescript
import { generateKeyPair, verifyGlyph, verifyReceipt } from '@glyphp/core'

// A stable server identity — reuse it across restarts
const keyPair = generateKeyPair()

// Verify a card's content hash and provenance signature
if (!verifyGlyph(card)) throw new Error('untrusted glyph card')

// Verify a call receipt against its embedded public key
if (!verifyReceipt(receipt)) throw new Error('forged receipt')
```

Also exports `computeGlyphId`, `canonicalHash`, `canonicalize`, `signGlyph`,
`signReceipt`, `toLexiconEntry`, `applyDepth`, and `sealResult`.
