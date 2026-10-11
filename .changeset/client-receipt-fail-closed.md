---
"@glyphp/client": patch
---

Receipt verification in `secureMode` now fails closed. `call()` used to return the payload unverified when the response carried no receipt, and skipped verification entirely when the card was not in the session cache (e.g. a card served without its signature, which still matched the pin by id and key). Both cases now throw `GlyphVerificationError`, and the receipt is always checked against the pinned card. Servers that do not sign receipts need the explicit `verifyReceipts: false` opt-out.
