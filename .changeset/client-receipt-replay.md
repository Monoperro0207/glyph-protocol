---
"@glyphp/client": patch
---

Receipt verification in `secureMode` now binds the receipt to the call it answers. `call()` already sent a fresh `callId`, but never compared it with the receipt, so a genuine envelope recorded from an earlier call of the same tool passed every check and could be replayed in place of the real response. The receipt's `clientCallId` (or `callId` on a 0.2 receipt) must now equal the `callId` sent, otherwise `call()` throws `GlyphVerificationError`. Servers that sign receipts but do not echo the client `callId` (RFC-0005) need the explicit `verifyReceipts: false` opt-out.
