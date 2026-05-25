---
'@glyphp/server': minor
---

**Operational hardening** — three security improvements:

- **Confirmation backlog limit.** Added `maxPendingConfirmations` option (default 10 000). When the pending confirmation map is full, the server returns `503 CONFIRMATION_BACKLOG_FULL` with a `Retry-After` header. The sweep is now unconditional rather than conditional on reaching a soft threshold.
- **Body size limit.** Added `maxBodyBytes` option (default 1 MiB). Requests exceeding the limit are rejected with `413 PAYLOAD_TOO_LARGE`. The `readJson()` helper checks `Content-Length` upfront and falls back to a streaming counter when absent.
- **Constant-time token comparison.** Bearer token checks now use SHA-256 hashing + `crypto.timingSafeEqual` instead of `Array.includes()`, eliminating timing-based token enumeration.

**Receipt version 0.3.** `callId` is now always server-generated (`randomUUID()` v4). The client-supplied value, if present, is preserved in the new optional `clientCallId` field on `CallReceipt`. `RECEIPT_VERSION` is bumped from `0.2` to `0.3`. See [RFC-0005](../spec/rfcs/RFC-0005-receipt-callid.md).
