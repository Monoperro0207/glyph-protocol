# @glyphp/exporter-otel

## 0.2.2

### Patch Changes

- Updated dependencies [85584c8]
  - @glyphp/types@1.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [44caa8c]
  - @glyphp/types@1.2.0

## 0.2.0

### Minor Changes

- 94c1b17: Initial release of `@glyphp/exporter-otel`.

  Turns Glyph signed receipts into:

  - one OpenTelemetry span per call (`otelReceiptCallback`), with canonical
    span attributes mirroring the receipt fields;
  - a JSON-Lines audit stream for SIEM ingestion (`jsonlReceiptCallback`);
  - both combined via `composeReceiptCallbacks(...)`.

  Wire into `new GlyphServer({ onCall: composeReceiptCallbacks(...) })`. The
  package is zero-runtime-dep — the OTel API is accepted as a duck-typed
  tracer so callers control the OTel version.

### Patch Changes

- Updated dependencies [94c1b17]
  - @glyphp/types@1.1.0
