# 01-hello-glyph

Minimal end-to-end example. Runs in under 2 minutes.

## Commands

```bash
# From repo root
pnpm install

# Terminal 1 — start the server
cd examples/01-hello-glyph
pnpm server

# Terminal 2 — run the client
cd examples/01-hello-glyph
pnpm client
```

## What it does

1. Registers a `greet` glyph with a `handler` that returns a greeting
2. Client connects via handshake, pulls the lexicon, fetches the full card
3. Calls the glyph with `call()` — prints the full `SealedEnvelope`
4. Calls with `invoke()` — prints just the payload
