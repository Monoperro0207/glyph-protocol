# 02-resolver-agent

The full Glyph discovery loop: a server with several tools, and an agent that
finds the right one from a natural-language intent.

## Commands

```bash
# From repo root
pnpm install

# Terminal 1 — start the server (5 glyphs)
cd examples/02-resolver-agent
pnpm run server

# Terminal 2 — run the agent
cd examples/02-resolver-agent
pnpm run client
```

## What it shows

1. **Handshake** — the agent connects and gets a session
2. **Lexicon** — five small entries (one per tool), not the full cards
3. **Resolver** — `@glyphp/resolver` ranks candidate glyphs for each
   natural-language query, using the zero-dependency lexical scorer
4. **Resolve → pull → verify → call** — the agent picks the best match,
   pulls its full card, verifies the ed25519 signature, and calls it,
   receiving a `SealedEnvelope`

This is the protocol's thesis end to end: the model holds a tiny lexicon,
resolves intent to a tool, and pulls the full card only when it needs it.
