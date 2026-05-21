# @glyph/resolver

Maps a natural-language intent to candidate glyphs, ranked by a pluggable `Scorer`.

## Default — zero dependencies

```typescript
import { GlyphResolver } from '@glyph/resolver'

const lexicon = await client.getLexicon()
const resolver = new GlyphResolver(lexicon) // uses LexicalScorer by default

const matches = await resolver.resolve('buscar un paciente', { limit: 3 })
// → [{ entry: LexiconEntry, score: number }, ...] sorted best-first
```

`LexicalScorer` scores token overlap against each glyph's `name`, `tags`, and
`intent` (a name/tag hit outweighs an intent hit). No model, no network.

## Opt-in — semantic embeddings

```bash
pnpm add @huggingface/transformers
```

```typescript
import { GlyphResolver, createTransformersScorer } from '@glyph/resolver'

const scorer = await createTransformersScorer() // downloads MiniLM on first run
const resolver = new GlyphResolver(lexicon, scorer)
```

`EmbeddingScorer` ranks by cosine similarity. The embedding function is
injected, so any backend works — pass your own `EmbedFn` to `new
EmbeddingScorer(embed)` to use an API instead.
