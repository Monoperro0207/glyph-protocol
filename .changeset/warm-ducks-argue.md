---
"@glyphp/client": minor
---

secureMode strict enforcement: review-only card changes (intent, tags, examples) now require human approval in secureMode. Add `autoApproveReviewChanges` opt-in to restore old behavior. Add automatic receipt verification in secureMode — validates receipt signature against pinned key, outputHash, inspectionHash, and glyphId on every call. Add `verifyReceipts` option to opt out.
