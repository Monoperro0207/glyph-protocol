# @glyphp/types

Shared TypeScript types for the Glyph Protocol — the wire-message interfaces
every other `@glyphp/*` package is built on.

```typescript
import { PROTOCOL_VERSION } from '@glyphp/types'
import type { GlyphCard, SealedEnvelope, CallReceipt } from '@glyphp/types'
```

Exports the interfaces `GlyphCard`, `LexiconEntry`, `HandshakeRequest` /
`HandshakeResponse`, `ConfirmationTicket`, `SealedEnvelope`, `CallReceipt`,
`ControlMessage`, `GlyphError`, and `JSONSchema`, plus the `PROTOCOL_VERSION`
constant — the only runtime value in the package.
