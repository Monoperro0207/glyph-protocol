---
"@glyphp/cli": minor
---

Polish the `glyphp` interactive shell: add `glyphp --help` (and `-h`) with
plain, scriptable usage text, and a non-TTY fallback — when stdout is not a
terminal (piped, redirected, CI) `glyphp` prints a short message pointing at
the one-shot `glyph <command>` CLI instead of hanging on an interactive
render. Both paths emit color-free text and respect `NO_COLOR`.
