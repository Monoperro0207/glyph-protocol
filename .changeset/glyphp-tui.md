---
"@glyphp/cli": minor
---

Add the `glyphp` interactive terminal — a new binary that boots an Ink-based
shell with an animated glyph cursor. `glyphp` (no args) opens a navigable menu
(↑/↓ or j/k, Enter, esc/q) with read-only panels for pins and the local key
registry, plus a help view. The one-shot `glyph <command>` binary is unchanged
and remains the path for scripting and CI. Adds `ink` + `react`. Write actions
(approve/revoke/keys) and the non-TTY fallback land in follow-up PRs.
