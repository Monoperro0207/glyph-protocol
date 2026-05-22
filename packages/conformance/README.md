# @glyph-protocol/conformance

An executable conformance suite for the [Glyph Protocol](../../spec/protocol.md).
Point it at any Glyph server and it reports whether the server matches the spec.

## CLI

```bash
glyph-conformance http://localhost:3100
```

Exit code `0` if every check passes, `1` otherwise.

## Library

```typescript
import { runConformance, formatReport } from '@glyph-protocol/conformance'

const report = await runConformance('http://localhost:3100')
console.log(formatReport(report))
console.log(report.passed) // boolean
```

Pass an in-process handler instead of hitting the network — useful in tests:

```typescript
import { GlyphServer } from '@glyph-protocol/server'

const server = new GlyphServer()
const report = await runConformance('http://glyph', { fetch: server.fetch })
```

## What it checks

The suite is **non-destructive** — it exercises discovery and error handling
only, and never calls a glyph (which would require knowing valid inputs):

- `/health` reports a protocol version
- the handshake accepts the supported protocol version and returns a valid
  `HandshakeResponse`
- the handshake rejects a version mismatch with `426`
- `/lexicon` returns valid `LexiconEntry` objects
- a glyph card validates against the schema
- a glyph card's signature and content hash verify
- an unknown glyph returns `404 NOT_FOUND` in the `GlyphError` envelope

Response shapes are validated against the JSON Schemas bundled from
[`spec/schemas/`](../../spec/schemas).
