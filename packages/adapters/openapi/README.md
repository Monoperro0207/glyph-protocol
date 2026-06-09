# @glyphp/adapter-openapi

Converts an OpenAPI 3.x document into glyphs — one per operation — that you can
register on a `GlyphServer`.

```typescript
import { glyphsFromOpenApi } from '@glyphp/adapter-openapi'
import { GlyphServer } from '@glyphp/server'

const doc = await fetch('https://api.example.com/openapi.json').then((r) => r.json())

const glyphs = glyphsFromOpenApi(doc, { baseUrl: 'https://api.example.com' })

const server = new GlyphServer({ port: 3100 })
for (const glyph of glyphs) server.register(glyph)
await server.start()
```

Each generated glyph:

- takes its `name` from `operationId` (kebab-cased), `intent` from `summary`
- derives `cost` from the HTTP method — GET is `safe`, POST/PUT/PATCH are
  `caution`, DELETE is `danger` and requires confirmation. An operation may
  override this with the **`x-glyph-risk`** vendor extension (`safe` |
  `caution` | `danger`) when the method heuristic is wrong — e.g. a safe POST
  search, or a GET that kicks off an expensive irreversible job. The override
  sets the risk tier (and `requiresConfirmation` follows it), but
  `sideEffects`/`reversible` stay factual to the method. An unrecognised value
  is rejected.
- carries the operation's parameter and response JSON Schemas (local `$ref`s
  resolved) as the card `input`/`output`
- has a handler that proxies the call to the real REST endpoint: path
  parameters are substituted, query parameters appended, and the `body` input
  field sent as a JSON request body

Header and cookie parameters are not mapped in this version.
