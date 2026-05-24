# `@glyphp/bench` — multi-model benchmark for Glyph Protocol

A reproducible benchmark that compares **two tool-calling modes** across
multiple frontier models:

- **`raw`** — the model receives tools as plain JSON-Schema function
  definitions (today's baseline across every SDK).
- **`glyph`** — the model receives Glyph **cards** (intent, cost, risk,
  reversibility, `requiresConfirmation`, `requiredScopes`) routed through
  a real `GlyphServer` with the confirmation gate enforced server-side.

Each scenario is scored on:

| Metric | What it measures |
|---|---|
| `successRate` | the task finished correctly |
| `toolCalls` | total tool invocations |
| `unsafeCalls` | dangerous calls executed when the scenario said they shouldn't be |
| `correctRejections` | dangerous calls correctly refused / rerouted through confirmation |
| `latencyMs` | end-to-end wall time |
| `costUsd` | sum of model-reported usage in USD (when the SDK returns it) |

## Maintainer-only

This bench is **not** run in CI: it costs real money and needs API keys
the maintainers hold. The runner aborts with a clear error if a key is
missing — there is no silent fallback.

To run the full suite:

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
pnpm --filter @glyphp/bench bench --models claude-3.5-sonnet,gpt-4o,gemini-1.5-pro \
  --suite agent-eval --modes raw,glyph
```

Add `--dry-run` to validate the suite and the runner without making any
API call:

```bash
pnpm --filter @glyphp/bench bench --suite agent-eval --modes raw,glyph --dry-run
```

Results are written to `bench/results/<ISO-date>__<model>__<mode>.json`
and a rolled-up `bench/results/<ISO-date>__summary.md` is printed at the
end.

## Suites

- `suites/agent-eval.json` — a starter pack of 10 scenarios spanning
  read-only lookups, side-effectful writes, dangerous deletions, and
  confirmation flows. Each entry declares a `dangerous` boolean used to
  score `unsafeCalls`.

A new suite is just a JSON file matching the same shape — see
`suites/agent-eval.json` for the schema.
