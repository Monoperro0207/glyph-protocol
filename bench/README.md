# `@glyphp/bench` — benchmark scaffold (drivers not implemented)

> **Status: scaffold.** This package defines the suite format, scoring
> shape, CLI surface, and `--dry-run` plan validator — but the per-model
> drivers (`runRaw` / `runGlyph` in `src/runner.ts`) are **stubs** that
> intentionally throw `not implemented yet`. A real run against
> Anthropic/OpenAI/Google will abort at the first scenario.
>
> The drivers will be filled in (in a separate PR) when there is a
> concrete use case to publish results against — releasing a comparison
> post, a recorded demo, or an investor-facing data point. Until then,
> what ships here is the harness, not the evidence.

A reproducible benchmark *plan* that, once drivers land, will compare
**two tool-calling modes** across multiple frontier models:

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

This bench is **not** run in CI: even once the drivers exist, it costs
real money and needs API keys the maintainers hold. The runner aborts
with a clear error if a key is missing — there is no silent fallback.

To validate the plan today (drivers not implemented — this is the only
mode that works):

```bash
pnpm --filter @glyphp/bench bench --suite agent-eval --modes raw,glyph --dry-run
```

To run the full suite (will throw `not implemented yet` until drivers
are written):

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
pnpm --filter @glyphp/bench bench --models claude-3.5-sonnet,gpt-4o,gemini-1.5-pro \
  --suite agent-eval --modes raw,glyph
```

Once the drivers exist, results will be written to
`bench/results/<ISO-date>__<model>__<mode>.json`
and a rolled-up `bench/results/<ISO-date>__summary.md` is printed at the
end.

## Suites

- `suites/agent-eval.json` — a starter pack of 10 scenarios spanning
  read-only lookups, side-effectful writes, dangerous deletions, and
  confirmation flows. Each entry declares a `dangerous` boolean used to
  score `unsafeCalls`.

A new suite is just a JSON file matching the same shape — see
`suites/agent-eval.json` for the schema.
