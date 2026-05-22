import type { LexiconEntry } from '@glyph-protocol/types'

export interface ResolverMatch {
  entry: LexiconEntry
  score: number // 0..1, higher is a better match
}

export interface Scorer {
  rank(query: string, entries: LexiconEntry[]): Promise<ResolverMatch[]>
}

const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'to', 'of', 'for', 'in', 'on', 'and', 'or', 'with',
  'my', 'is', 'it', 'that', 'this', 'how', 'do', 'can', 'find', 'get',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'para', 'por', 'en',
  'con', 'mi', 'que', 'como', 'se', 'al',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñü]+/i)
    .filter((token) => token.length > 1)
}

function queryTokens(query: string): string[] {
  const all = tokenize(query)
  const meaningful = all.filter((token) => !STOPWORDS.has(token))
  return meaningful.length > 0 ? meaningful : all
}

/**
 * Default zero-dependency scorer. Scores each query token by token overlap:
 * a hit in the glyph name or tags is worth more than a hit in the intent.
 */
export class LexicalScorer implements Scorer {
  async rank(query: string, entries: LexiconEntry[]): Promise<ResolverMatch[]> {
    const qTokens = queryTokens(query)
    if (qTokens.length === 0) {
      return entries.map((entry) => ({ entry, score: 0 }))
    }
    return entries.map((entry) => {
      const strong = new Set([
        ...tokenize(entry.name),
        ...entry.tags.flatMap(tokenize),
      ])
      const intent = new Set(tokenize(entry.intent))
      let sum = 0
      for (const token of qTokens) {
        if (strong.has(token)) sum += 1
        else if (intent.has(token)) sum += 0.6
      }
      return { entry, score: sum / qTokens.length }
    })
  }
}

/**
 * Resolves a natural-language intent to candidate glyphs, ranked by a Scorer.
 * Defaults to the zero-dependency LexicalScorer.
 */
export class GlyphResolver {
  private entries: LexiconEntry[]
  private scorer: Scorer

  constructor(entries: LexiconEntry[], scorer: Scorer = new LexicalScorer()) {
    this.entries = entries
    this.scorer = scorer
  }

  async resolve(
    query: string,
    options?: { limit?: number; minScore?: number }
  ): Promise<ResolverMatch[]> {
    const limit = options?.limit ?? 5
    const minScore = options?.minScore ?? 0
    const ranked = await this.scorer.rank(query, this.entries)
    return ranked
      .filter((match) => match.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}
