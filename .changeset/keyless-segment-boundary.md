---
'@glyphp/core': patch
---

Security fix: `KeylessVerifier` identity/issuer allow-lists no longer match
bare prefixes. `repo:acme/tools` used to authorize `repo:acme/tools-evil` via
`startsWith`; an allow-list entry now matches exactly or as a prefix ending at
a segment boundary (`:` or `/`). Namespace entries like `repo:acme/` keep
working. RFC-0007 §4.2 updated to make the boundary rule normative.
