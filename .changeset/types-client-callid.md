---
'@glyphp/types': minor
---

Add optional `clientCallId?: string` field to `CallReceipt`. When a client sends a `callId` in the request body, the server now preserves it as `clientCallId` on the receipt while generating its own UUID v4 for `callId`. This is an additive change — existing consumers that ignore the new field continue to work. See [RFC-0005](../spec/rfcs/RFC-0005-receipt-callid.md).
