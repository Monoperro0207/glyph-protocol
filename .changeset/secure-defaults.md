---
'@glyphp/client': minor
'@glyphp/cli': minor
---

Production-grade defaults for consumer-side update governance.

- `FilePinStore` — a persistent `PinStore` that writes pins atomically to a
  JSON file. Survives restarts. Recommended for any deployed agent.
- `secureMode: true` on `GlyphClient` refuses to construct without a
  `PinStore` configured, so a tool that has not been deliberately approved
  can never run.
- New CLI commands: `glyph pins list`, `glyph approve <card>`,
  `glyph revoke <tool>`, `glyph manifest verify <src>`. Pins live at
  `~/.glyph/pins.json` by default; `--file <path>` keeps a project-local
  store.

All additions are opt-in — existing callers that do not pass `secureMode`
or use the new CLI commands behave exactly as before.
