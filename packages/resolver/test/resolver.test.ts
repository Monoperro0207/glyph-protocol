import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LexiconEntry } from '@glyphp/types'
import {
  createTransformersScorer,
  EmbeddingScorer,
  type EmbedFn,
  GlyphResolver,
  LexicalScorer,
} from '../src/index.js'

const lexicon: LexiconEntry[] = [
  {
    id: '1',
    name: 'search-patients',
    intent: 'Busca pacientes por nombre o cédula',
    tags: ['clínico', 'consulta'],
    riskTier: 'safe',
  },
  {
    id: '2',
    name: 'send-email',
    intent: 'Envía un correo electrónico a un destinatario',
    tags: ['comunicación'],
    riskTier: 'caution',
  },
  {
    id: '3',
    name: 'delete-record',
    intent: 'Elimina permanentemente un registro de la base de datos',
    tags: ['datos'],
    riskTier: 'danger',
  },
]

test('LexicalScorer ranks a name match first', async () => {
  const ranked = await new LexicalScorer().rank('search patients', lexicon)
  const top = [...ranked].sort((a, b) => b.score - a.score)[0]
  assert.equal(top.entry.id, '1')
  assert.equal(top.score, 1)
})

test('LexicalScorer keeps every score within 0..1', async () => {
  const ranked = await new LexicalScorer().rank('correo electrónico', lexicon)
  for (const match of ranked) {
    assert.ok(match.score >= 0 && match.score <= 1)
  }
})

test('GlyphResolver resolves an intent to the right glyph', async () => {
  const resolver = new GlyphResolver(lexicon)
  const matches = await resolver.resolve('enviar correo electrónico')
  assert.equal(matches[0].entry.id, '2')
})

test('GlyphResolver respects the limit option', async () => {
  const resolver = new GlyphResolver(lexicon)
  const matches = await resolver.resolve('search patients', { limit: 1 })
  assert.equal(matches.length, 1)
})

test('GlyphResolver filters out matches below minScore', async () => {
  const resolver = new GlyphResolver(lexicon)
  const matches = await resolver.resolve('zzzznothing', { minScore: 0.1 })
  assert.equal(matches.length, 0)
})

test('EmbeddingScorer ranks by cosine similarity of injected vectors', async () => {
  const entries: LexiconEntry[] = [
    { id: 'a', name: 'a', intent: 'about cats', tags: [], riskTier: 'safe' },
    { id: 'b', name: 'b', intent: 'about dogs', tags: [], riskTier: 'safe' },
  ]
  const stubEmbed: EmbedFn = async (texts) =>
    texts.map((t) => (t.includes('dog') ? [1, 0] : [0, 1]))
  const resolver = new GlyphResolver(entries, new EmbeddingScorer(stubEmbed))
  const matches = await resolver.resolve('dog')
  assert.equal(matches[0].entry.id, 'b')
  assert.ok(matches[0].score > matches[1].score)
})

test('createTransformersScorer fails clearly when the dep is absent', async () => {
  await assert.rejects(createTransformersScorer(), /@huggingface\/transformers/)
})
