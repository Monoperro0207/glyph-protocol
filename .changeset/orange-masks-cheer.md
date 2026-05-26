---
"@glyphp/adapter-openapi": major
---

Redact API keys, tokens, and other secrets from HTTP error messages to prevent credential leaks in logs and error displays. The `redactUrl()` helper replaces sensitive query parameter values (api_key, token, secret, password, etc.) with `***` before they appear in thrown Error messages.
