---
'@glyphp/conformance': patch
---

`security.rateLimit` now runs as the very last check across the entire
suite instead of in the middle of the `security` level. The burst it
sends drains the server's rate-limit bucket; running it in-line caused
`security.timeout` and every `governance` check on a tightly rate-limited
server (e.g. the `examples/11-production-deploy` template with
`max: 200, windowMs: 60_000`) to receive `429` instead of the codes they
were testing for, failing the suite spuriously.

No schema change: the emitted `CheckResult` keeps `level: 'security'`
and the name `security.rateLimit`, so badge JSON, markdown reports, and
downstream consumers see no difference — only the moment of execution
moves. The check is still skipped when the caller did not request the
`security` level.
