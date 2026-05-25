---
'@glyphp/adapter-openapi': major
---

**Breaking change: explicit baseUrl trust required.** The adapter no longer uses `doc.servers[0].url` from the OpenAPI document by default — this was a SSRF vector when consuming untrusted specs. Two new options replace the implicit behaviour:

- `allowDocumentServerUrl?: boolean` (default `false`) — opt in to the previous implicit-behaviour when you trust the spec.
- `allowedHosts?: string[]` — an optional host allowlist to validate the resolved baseUrl against.

**Migration:**
```ts
// Before — implicitly trusted doc.servers[0].url
new OpenApiAdapter({ document: spec })

// After — must opt in OR provide explicit baseUrl
new OpenApiAdapter({ document: spec, allowDocumentServerUrl: true })
// or
new OpenApiAdapter({ document: spec, baseUrl: 'https://api.example.com' })
```

Without either option, the adapter throws:
> `OpenAPI: refusing to use spec-declared servers[0].url without explicit allowDocumentServerUrl: true or options.baseUrl. SSRF risk if the spec is untrusted.`
