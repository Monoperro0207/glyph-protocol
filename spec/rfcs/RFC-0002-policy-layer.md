# RFC-0002: Scope-based policy layer

- **Status:** Operational reference
- **Targets:** Glyph Protocol 1.0
- **Author:** Patrick Espino
- **Created:** 2026-05-24

## 1. Motivation

Glyph 1.0 ships a transport-level auth gate (bearer token / custom verify
hook) and a per-glyph confirmation gate. Neither answers the question that
multi-tenant deployments ask first:

> *"This caller is authenticated. Which glyphs are they allowed to call?"*

Today the only answers are (a) put every glyph behind the same token, or
(b) write ad-hoc middleware in the host application. Both leak policy into
code that has nothing to do with the contract the glyph card already
publishes.

The card is the natural place to declare *who* may invoke a glyph — just as
it declares cost, risk, idempotency and confirmation. RFC-0002 makes that
explicit with a minimum-viable scope model that does not require new wire
endpoints.

## 2. Wire surface

A `GlyphCard` MAY carry a `requiredScopes` field — an array of opaque,
provider-defined scope strings:

```json
{
  "name": "reports.read",
  "intent": "Read a financial report",
  "requiredScopes": ["reports:read", "finance:view"]
}
```

When the field is **absent** or has been canonicalized away (empty array),
the glyph imposes no scope policy and behaves exactly as a glyph compiled
before this RFC. When it is **present and non-empty**, the server MUST
refuse calls whose caller principal does not carry every listed scope.

`requiredScopes` is part of the canonical card content. Changing it changes
the card id — consumers MUST re-approve the new card before invoking it.
`diffCards` reports the change as **breaking** (security-relevant).

## 3. Server semantics

A server MAY accept a `policy: PolicyResolver` option:

```ts
type PolicyResolver = (req: Context) =>
  | CallerPrincipal
  | undefined
  | Promise<CallerPrincipal | undefined>

interface CallerPrincipal {
  id?: string
  scopes: string[]
  tenant?: string
}
```

The resolver is called once per request that reaches the call/prepare path.
The server MUST evaluate the scope gate **after** input validation and
**before** the confirmation gate, so that:

- A request rejected for missing scopes never burns a single-use
  confirmation token.
- A handler with side effects never runs when the caller lacks authority,
  even if the request supplies a valid confirmation token (a confirmation
  authorises *side effects*, not *access*).

When the glyph declares `requiredScopes` and the resolver returns
`undefined` (or no resolver is configured), the server MUST treat the
caller as carrying no scopes — i.e., reject with `403 INSUFFICIENT_SCOPE`.

## 4. Error code

A new code joins the existing 4xx family:

| HTTP | Code | Meaning |
|---|---|---|
| 403 | `INSUFFICIENT_SCOPE` | The caller principal is missing one or more scopes the glyph requires. |

The error payload echoes the *missing* scopes (not the full required set,
which is already on the public card) under `details.missing`.

## 5. Non-goals

- **Hierarchical scopes / role definitions.** Scopes are opaque strings.
  Whatever issues the caller principal (a JWT issuer, an upstream gateway,
  an OAuth scope claim) defines how those strings map to roles.
- **Tenant isolation enforcement.** `tenant` is propagated to the handler
  (via the handler context in future versions) but the protocol does not
  mandate how data is partitioned — that lives in handler code.
- **A discovery endpoint for scopes.** The card already advertises
  `requiredScopes`. No new endpoint is added.

## 6. Backwards compatibility

- Cards published before this RFC carry no `requiredScopes`, so their ids
  do not change and they remain callable by any authenticated caller.
- Servers that never configure a `policy` resolver keep their previous
  behaviour for un-scoped glyphs and reject scoped glyphs (any value of
  `requiredScopes`) with `403 INSUFFICIENT_SCOPE` — which is the safe
  default for a server that hasn't opted into policy.
- The new error code is additive; conformance level 2 (execution) accepts
  servers that never emit it.

## 7. Conformance impact

Conformance level 3 (security) gains an OPTIONAL check:

> If the fixture set includes a glyph carrying `requiredScopes`, a call
> without a matching principal MUST return `403 INSUFFICIENT_SCOPE`.

Servers that do not configure a policy resolver MAY skip the check; the
fixture suite advertises this as `scope.enforcement` and the badge shows
it under `security` only when the resolver is wired.

## 8. Example

```ts
const reports = defineGlyph({
  name: 'reports.read',
  intent: 'Read a financial report for a tenant',
  cost: { /* … */ },
  input: z.object({ reportId: z.string() }),
  output: z.object({ /* … */ }),
  provider: 'finops',
  requiredScopes: ['reports:read'],
  handler: async ({ reportId }) => { /* … */ },
})

const server = new GlyphServer({
  policy: (c) => {
    const claims = decodeJwt(c.req.header('authorization') ?? '')
    return claims && { id: claims.sub, scopes: claims.scope.split(' '), tenant: claims.tenant }
  },
})
server.register(reports)
```

A caller whose JWT carries `scope: "reports:read"` passes. A caller whose
JWT only carries `scope: "other:scope"` is rejected with:

```json
{
  "error": {
    "code": "INSUFFICIENT_SCOPE",
    "message": "Caller is missing one or more required scopes",
    "details": { "glyph": "reports.read", "missing": ["reports:read"] }
  }
}
```
