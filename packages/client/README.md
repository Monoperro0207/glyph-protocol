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

## Production posture

`GlyphClient.production(options)` builds a client with the recommended hardened
defaults so the safe configuration is the easy path — `secureMode`,
`verifyReceipts`, no auto-approval of card changes, and no trust-on-first-use. A
`PinStore` is **required** (it throws if missing); every default stays
overridable.

```typescript
import { GlyphClient, FilePinStore } from '@glyphp/client'

const client = GlyphClient.production({
  baseUrl: 'https://glyph.example',
  pins: new FilePinStore('./pins.json'),
})
```

## Card caching within a session

The client caches each card in memory the first time it fetches it and does
**not** invalidate that cache for the lifetime of the client instance. This is
deliberate: the trust model treats a card change as an *event to detect at a
boundary* (the pin gate, `diffCards`, update manifests), not something to pick
up silently mid-session — a server rotating a card under an in-flight session
should not be able to change what you call without re-approval. If you need to
observe a server-side card change within one process, create a fresh
`GlyphClient` (or re-approve through the pin workflow, which always operates
on the freshly fetched card).

## Rendering tool output for an LLM

`renderEnvelope` turns a `SealedEnvelope` into the exact text block to hand a
model. The payload is wrapped in a per-render, cryptographically-random
boundary nonce that untrusted content cannot predict — so a tool result
cannot forge the closing marker and "break out" of the data channel. Emit
`dataPreamble()` once as a trusted system message to explain the convention.

```typescript
import { GlyphClient, renderEnvelope, dataPreamble } from '@glyphp/client'

const envelope = await client.call('search', { q: 'glyph protocol' })

// systemMessage: dataPreamble().content
// toolResult:    the delimited, inert data block
const block = renderEnvelope(envelope, { verify: (e) => Boolean(e.receipt) })
```

This raises the floor against prompt injection; it does not eliminate it. See
`spec/trust.md`.
