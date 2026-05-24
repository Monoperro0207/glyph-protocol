---
'@glyphp/exporter-otel': minor
---

Initial release of `@glyphp/exporter-otel`.

Turns Glyph signed receipts into:

- one OpenTelemetry span per call (`otelReceiptCallback`), with canonical
  span attributes mirroring the receipt fields;
- a JSON-Lines audit stream for SIEM ingestion (`jsonlReceiptCallback`);
- both combined via `composeReceiptCallbacks(...)`.

Wire into `new GlyphServer({ onCall: composeReceiptCallbacks(...) })`. The
package is zero-runtime-dep — the OTel API is accepted as a duck-typed
tracer so callers control the OTel version.
