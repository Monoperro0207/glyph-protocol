# 04-inert-data

How Glyph keeps tool output **inert** — data, never instructions.

## Run

```bash
# From repo root
pnpm install

cd examples/04-inert-data
pnpm start
```

## What it does

A glyph whose handler deliberately laces its output with a prompt-injection
payload: invisible Unicode (a bidi override and tag-block-encoded text) plus a
plainly visible instruction. In one run it shows:

1. **Sanitized payload** — the server strips the invisible characters before
   delivery.
2. **Signed inspection report** — the `SealedEnvelope` records exactly what was
   removed; the `CallReceipt` commits to it by hash.
3. **`renderEnvelope` output** — the result wrapped in an unforgeable
   `<glyph:data boundary="…">` block, the form an LLM should receive it in.

The visible bait survives sanitization — that is expected. What changes is
that it can no longer hide, and it is contained inside a data boundary a
payload cannot forge. See [`spec/trust.md`](../../spec/trust.md) for the
limits of this defense.
