# @glyphp/server

Serve signed, self-describing glyph cards over the Glyph Protocol. Built on
[Hono](https://hono.dev), so it runs on Node and any fetch-based runtime.

```typescript
import { GlyphServer, defineGlyph } from '@glyphp/server'
import { z } from 'zod'

const greet = defineGlyph({
  name: 'greet',
  intent: 'Returns a friendly greeting for the given name',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  provider: 'my-service',
  handler: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
})

const server = new GlyphServer({ port: 3100 })
server.register(greet)
await server.start()
```

`GlyphServer` signs every card it registers, enforces the input and output
schemas and the confirmation gate, and emits a signed `CallReceipt` per call.
Optional bearer-token auth and rate limiting are off by default.
