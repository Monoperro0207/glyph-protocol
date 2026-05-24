# Why Glyph vs MCP / OpenAPI / function-calling

This is a candid comparison. Glyph is not always the right answer; the
table below names when it is.

## TL;DR

| Concern | function-calling | OpenAPI | MCP | Glyph |
|---|---|---|---|---|
| Discoverable, machine-readable contract | yes (per-call) | yes (per-spec) | yes (per-server) | yes (per-tool, content-addressed) |
| Output is signed and tamper-evident | no | no | no | **yes** |
| Cards are content-addressed (a change is detectable) | no | no | no | **yes** |
| Output is sanitised against prompt-injection | no | no | no | **yes** |
| Cost / risk / reversibility annotations | no | no | partial (annotations) | **yes, structured** |
| Confirmation gate enforced by the server | no | no | no | **yes** |
| Auditable signed receipt per call | no | no | no | **yes** |
| Key rotation / revocation in the protocol | n/a | n/a | no | **yes (RFC-0001)** |
| Adapter-friendly (consumes existing OpenAPI/MCP) | n/a | n/a | n/a | **yes** |

## When function-calling is enough

You have one model, one provider, and the tools live in the same process
as the agent. There is no third-party publisher, no audit obligation, no
need to prove a tool did not change between approval and execution.
Function-calling — whatever your model provider calls it — is the
shortest path and Glyph is overkill.

## When OpenAPI is enough

The tool is a service that already publishes an OpenAPI spec, the
consumer trusts the upstream provider operationally, and the upstream
provider speaks for itself (auth, rate-limit, contract). The agent does
not need to gate execution on risk and does not need a tamper-evident
receipt. OpenAPI is the right substrate. (Glyph's
`@glyphp/adapter-openapi` will happily turn it into glyphs the day you
do need those things.)

## When MCP is enough

You are inside an editor / IDE / desktop assistant that already speaks
MCP. The tools run locally, the trust boundary is the user's machine,
and tool annotations (`readOnlyHint`, `destructiveHint`) are advisory
hints you trust the local server to set honestly. MCP is the right
substrate for that environment. (Glyph's `@glyphp/adapter-mcp` will
hoist MCP tools to glyphs the day you cross a trust boundary.)

## When Glyph is the right answer

- A model needs to consume tools published by **multiple, distinct
  providers** and the consumer should be able to verify each card's
  origin.
- The agent's output payload is a **prompt-injection surface** and you
  want sanitisation to be enforced server-side and committed to a
  signed receipt — so the cleaning is tamper-evident, not advisory.
- You need a **confirmation gate** that the server enforces, not just an
  advisory annotation that the model is free to ignore.
- You need **audit receipts** that survive log rotation and can be
  re-verified independently of the runtime.
- You need to **rotate or revoke a signing key** without invalidating
  every previously approved tool ([RFC-0001](../spec/rfcs/RFC-0001-key-registry.md)).
- You want a **conformance contract** with levels a server can advertise.
- You expect to **adopt other protocols' tools** (MCP, OpenAPI) without
  giving up the guarantees above.

If most of that list applies, Glyph is the substrate. If most does not,
use one of the others — and reach for Glyph the day the constraints
shift.
