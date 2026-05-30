---
"@glyphp/client": minor
"@glyphp/cli": minor
---

Add `FilePendingAuditQueue` (a persistent `PendingAuditQueue` that mirrors
`FilePinStore`) and the `glyph audit list` CLI command. The command reads the
persisted queue (default `~/.glyph/pending-audits.json`, override with `--file`)
and renders each parked tool update with its diff and a breaking/review verdict,
read-only. It exits non-zero when any parked update carries a breaking change
awaiting review, so it can gate CI. Promotion stays a separate step
(`glyph approve` or the autonomous runner).
