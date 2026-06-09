---
"@glyphp/adapter-openapi": minor
---

Support the `x-glyph-risk` vendor extension on OpenAPI operations. The API
author can override the HTTP-method risk heuristic (`safe` | `caution` |
`danger`) when it is wrong — e.g. a genuinely safe POST search, or a GET that
triggers an expensive, irreversible job. The override sets the risk tier (and
`requiresConfirmation` follows it); `sideEffects`/`reversible` stay factual to
the method, so the override never misreports whether the call mutates state. An
unrecognised value is rejected (fail-closed). Operations without the extension
behave exactly as before.
