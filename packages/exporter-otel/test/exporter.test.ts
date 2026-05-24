import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CallReceipt } from '@glyphp/types'
import {
  composeReceiptCallbacks,
  jsonlReceiptCallback,
  otelReceiptCallback,
  type OtelTracerLike,
} from '../src/index.js'

const sampleReceipt: CallReceipt = {
  receiptVersion: '0.2',
  callId: 'call-123',
  glyphId: 'sha256:abc',
  glyphName: 'reports.read',
  inputHash: 'sha256:in',
  outputHash: 'sha256:out',
  inspectionHash: 'sha256:insp',
  riskTier: 'caution',
  provider: 'finops',
  latencyMs: 42,
  timestamp: '2026-05-24T19:00:00.000Z',
  serverPublicKey: 'pub-key',
  signature: 'sig',
}

function mockTracer(): {
  tracer: OtelTracerLike
  spans: Array<{ name: string; attrs: Record<string, unknown>; ended: boolean }>
} {
  const spans: Array<{ name: string; attrs: Record<string, unknown>; ended: boolean }> = []
  const tracer: OtelTracerLike = {
    startSpan(name, options) {
      const entry = { name, attrs: options?.attributes ?? {}, ended: false }
      spans.push(entry)
      return {
        setStatus: () => undefined,
        end: () => {
          entry.ended = true
        },
      }
    },
  }
  return { tracer, spans }
}

test('otelReceiptCallback opens one span per receipt with the canonical attributes', () => {
  const { tracer, spans } = mockTracer()
  const cb = otelReceiptCallback({
    tracer,
    resourceAttributes: { 'service.name': 'billing' },
  })
  cb(sampleReceipt)

  assert.equal(spans.length, 1)
  const [span] = spans
  assert.equal(span.name, 'glyph.call reports.read')
  assert.equal(span.attrs['service.name'], 'billing')
  assert.equal(span.attrs['glyph.name'], 'reports.read')
  assert.equal(span.attrs['glyph.id'], 'sha256:abc')
  assert.equal(span.attrs['glyph.call_id'], 'call-123')
  assert.equal(span.attrs['glyph.risk_tier'], 'caution')
  assert.equal(span.attrs['glyph.latency_ms'], 42)
  assert.equal(span.attrs['glyph.input_hash'], 'sha256:in')
  assert.equal(span.attrs['glyph.output_hash'], 'sha256:out')
  assert.equal(span.attrs['glyph.inspection_hash'], 'sha256:insp')
  assert.ok(span.ended)
})

test('jsonlReceiptCallback writes one newline-terminated JSON object per receipt', () => {
  const lines: string[] = []
  const cb = jsonlReceiptCallback({ write: (l) => lines.push(l) })
  cb(sampleReceipt)
  cb({ ...sampleReceipt, callId: 'call-456' })

  assert.equal(lines.length, 2)
  assert.ok(lines[0].endsWith('\n'))
  const parsed = JSON.parse(lines[0])
  assert.equal(parsed.callId, 'call-123')
  assert.equal(parsed.glyphName, 'reports.read')
  assert.equal(JSON.parse(lines[1]).callId, 'call-456')
})

test('composeReceiptCallbacks fans out and survives a throwing inner callback', () => {
  const { tracer, spans } = mockTracer()
  const lines: string[] = []
  const throwing = () => {
    throw new Error('boom')
  }
  const cb = composeReceiptCallbacks(
    otelReceiptCallback({ tracer }),
    throwing,
    jsonlReceiptCallback({ write: (l) => lines.push(l) })
  )
  // Silence the noisy error log for this assertion.
  const origError = console.error
  console.error = () => undefined
  try {
    cb(sampleReceipt)
  } finally {
    console.error = origError
  }

  assert.equal(spans.length, 1)
  assert.equal(lines.length, 1)
})
