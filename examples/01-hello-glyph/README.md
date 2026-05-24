# 01-hello-glyph

Minimal end-to-end example. Runs in under 2 minutes.

> **Prototyping only.** This example uses an ephemeral key, no auth, no
> rate limit and no pin store. For a deployable starting point see
> [`examples/11-production-deploy`](../11-production-deploy) or scaffold
> with `glyph init my-server` (which defaults to the `production-server`
> profile).

## Commands

```bash
# From repo root
pnpm install

# Terminal 1 — start the server
cd examples/01-hello-glyph
pnpm run server

# Terminal 2 — run the client
cd examples/01-hello-glyph
pnpm run client
```

## What it does

1. Registers a `greet` glyph with a `handler` that returns a greeting
2. Client connects via handshake, pulls the lexicon, fetches the full card
3. Calls the glyph with `call()` — prints the full `SealedEnvelope`
4. Calls with `invoke()` — prints just the payload
