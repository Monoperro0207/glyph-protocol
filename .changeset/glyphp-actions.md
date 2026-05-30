---
"@glyphp/cli": minor
---

Add interactive write actions to the `glyphp` shell: **Approve** (pin a card
from a file or URL) and **Revoke** (block a previously approved tool). Both run
through a three-step `ActionFlow` — type the argument, then an explicit
confirmation gate (`y`/`n`) that must be accepted before anything executes;
typing or `esc` never triggers the action. Adds `ink-text-input`.
