import type { LexiconEntry } from '@glyph-protocol/types'
import type { ResolverMatch, Scorer } from './resolver.js'

export type EmbedFn = (texts: string[]) => Promise<number[][]>

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Opt-in semantic scorer. Ranks entries by cosine similarity between the
 * embedding of the query and the embedding of each glyph's intent. The
 * embedding function is injected, so this class is backend-agnostic.
 */
export class EmbeddingScorer implements Scorer {
  constructor(private embed: EmbedFn) {}

  async rank(query: string, entries: LexiconEntry[]): Promise<ResolverMatch[]> {
    if (entries.length === 0) return []
    const vectors = await this.embed([query, ...entries.map((e) => e.intent)])
    const queryVec = vectors[0]
    return entries.map((entry, i) => {
      const cos = cosineSimilarity(queryVec, vectors[i + 1])
      return { entry, score: (cos + 1) / 2 } // normalize -1..1 to 0..1
    })
  }
}

/**
 * Builds an EmbeddingScorer backed by transformers.js running locally.
 * Requires the optional peer dependency `@huggingface/transformers`
 * (the successor to `@xenova/transformers`).
 */
export async function createTransformersScorer(
  model = 'Xenova/all-MiniLM-L6-v2'
): Promise<EmbeddingScorer> {
  // The indirect, string-typed specifier keeps this optional peer dependency
  // out of the static module graph and the type-check.
  const moduleName: string = '@huggingface/transformers'
  let transformers: any
  try {
    transformers = await import(moduleName)
  } catch {
    throw new Error(
      '@glyph-protocol/resolver: the embedding scorer requires @huggingface/transformers. ' +
        'Install it with: pnpm add @huggingface/transformers'
    )
  }
  const extractor = await transformers.pipeline('feature-extraction', model)
  const embed: EmbedFn = async (texts) => {
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return output.tolist() as number[][]
  }
  return new EmbeddingScorer(embed)
}
