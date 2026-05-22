# @glyphp/client

A client for the Glyph Protocol — discover and call glyphs on any Glyph server.

```typescript
import { GlyphClient } from '@glyphp/client'

const client = new GlyphClient({ baseUrl: 'http://localhost:3100' })

// Handshake — negotiates the protocol version and returns the lexicon
const { lexicon } = await client.connect()

// Fetch a glyph card
const card = await client.getCard('greet')

// Call a glyph; `invoke` returns just the payload
const result = await client.invoke('greet', { name: 'Ada' })
```

For a glyph whose card declares `cost.requiresConfirmation`, call `prepare()`
first to obtain a single-use confirmation token, then pass it to `call()`.
