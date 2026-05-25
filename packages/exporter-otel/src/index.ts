/**
 * @glyphp/exporter-otel — Receipt exporter for OpenTelemetry and SIEM.
 *
 * Glyph servers already produce a signed `CallReceipt` for every call and
 * pass it to an optional `onCall` hook. This package turns those receipts
 * into:
 *
 *  - an OpenTelemetry span (one per call), so receipts show up in any
 *    OTLP-compatible backend (Tempo, Honeycomb, Datadog, etc.) without
 *    having to instrument the handler;
 *  - a JSON-Lines audit stream, suitable for ingestion by a SIEM that
 *    tails a file (Splunk UF, Vector, Filebeat, …).
 *
 * Both hooks accept a `CallReceipt` and have no other dependency on the
 * server runtime, so they compose with any deployment.
 */
import type { CallReceipt } from '@glyphp/types'

/**
 * Minimal shape of `Tracer.startSpan(...)` from `@opentelemetry/api`. We
 * accept anything that quacks like it so callers can plug in their real
 * tracer without forcing a hard dep on the OTel API package.
 */
export interface OtelTracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, unknown> },
  ): {
    setStatus(status: { code: number; message?: string }): unknown
    setAttribute?(key: string, value: unknown): unknown
    end(endTime?: number): void
  }
}

/**
 * Build an `onCall(receipt)` callback that opens an OpenTelemetry span
 * per receipt. The span attributes commit to the same fields the receipt
 * commits to, so downstream observability can be cross-referenced with
 * the signed audit trail.
 *
 * The span ends synchronously — receipts are *post-execution* records,
 * not live span timing. Span name format: `glyph.call <glyphName>`.
 */
export function otelReceiptCallback(opts: {
  tracer: OtelTracerLike
  /**
   * Optional service-level attributes added to every span (e.g.
   * `{ "service.name": "billing", "deployment.environment": "prod" }`).
   */
  resourceAttributes?: Record<string, unknown>
}): (receipt: CallReceipt) => void {
  const { tracer, resourceAttributes } = opts
  return (receipt) => {
    const span = tracer.startSpan(`glyph.call ${receipt.glyphName}`, {
      attributes: {
        ...resourceAttributes,
        'glyph.name': receipt.glyphName,
        'glyph.id': receipt.glyphId,
        'glyph.call_id': receipt.callId,
        'glyph.risk_tier': receipt.riskTier,
        'glyph.provider': receipt.provider,
        'glyph.latency_ms': receipt.latencyMs,
        'glyph.input_hash': receipt.inputHash,
        'glyph.output_hash': receipt.outputHash,
        'glyph.inspection_hash': receipt.inspectionHash,
        'glyph.server_public_key': receipt.serverPublicKey,
        'glyph.receipt_version': receipt.receiptVersion,
      },
    })
    // OK = 1 per OTel semantic conventions. Status set explicitly so the
    // backend doesn't infer UNSET from an unset value.
    span.setStatus({ code: 1 })
    span.end()
  }
}

/**
 * Build an `onCall(receipt)` callback that appends one JSON object per
 * receipt to a writable stream (file, socket, pipe). The line is
 * newline-terminated so it can be tailed by SIEM agents that expect
 * JSONL.
 *
 * The caller owns the stream's lifecycle — typically a
 * `fs.createWriteStream(path, { flags: 'a' })` in `appendFile` mode.
 */
export function jsonlReceiptCallback(opts: {
  write: (line: string) => void
}): (receipt: CallReceipt) => void {
  return (receipt) => {
    opts.write(`${JSON.stringify(receipt)}\n`)
  }
}

/**
 * Compose multiple `onCall` callbacks into one — each is called in order
 * and an exception in one does not stop the others. The Glyph server
 * already wraps `onCall` in a try/catch, but this lets a single callback
 * fan out to OTel + SIEM + custom audit without that wrapping logic
 * being duplicated in every host.
 */
export function composeReceiptCallbacks(
  ...callbacks: Array<(receipt: CallReceipt) => void>
): (receipt: CallReceipt) => void {
  return (receipt) => {
    for (const cb of callbacks) {
      try {
        cb(receipt)
      } catch (err) {
        console.error('[glyph/exporter-otel] callback threw:', err)
      }
    }
  }
}
