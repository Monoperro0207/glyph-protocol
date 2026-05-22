# @glyphp/conformance

An executable conformance suite for the [Glyph Protocol](../../spec/protocol.md).
Point it at any Glyph server and it reports whether the server matches the spec.

## CLI

```bash
glyph-conformance http://localhost:3100
```

Exit code `0` if every check passes, `1` otherwise.

## Library

```typescript
import { runConformance, formatReport } from '@glyphp/conformance'

const report = await runConformance('http://localhost:3100')
console.log(formatReport(report))
console.log(report.passed) // boolean
```

Pass an in-process handler instead of hitting the network — useful in tests:

```typescript
import { GlyphServer } from '@glyphp/server'

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
- the bundled `Sanitization` schema validates representative samples

Response shapes are validated against the JSON Schemas bundled from
[`spec/schemas/`](../../spec/schemas).

### What it does not check

Because the suite never calls a glyph, it never sees a `SealedEnvelope` or an
`inspection` report produced by a live call. The `schema.sanitization` check
confirms only that the `Sanitization` wire schema is published and
self-consistent — **it does not prove that a server actually sanitizes its
output.** Verifying inert-data behavior end to end requires invoking a glyph
with known-hostile input, which is destructive and therefore out of scope
here; [`04-inert-data`](../../examples/04-inert-data) demonstrates it instead.
