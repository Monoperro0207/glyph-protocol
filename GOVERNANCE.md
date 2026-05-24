# Glyph Protocol — Governance

Glyph Protocol is open-source software (Apache 2.0). This document records
how decisions are made, how the wire protocol evolves, and how contributors
can participate.

## Roles

| Role | Responsibilities |
|---|---|
| **Maintainer** | Merges PRs, cuts releases, signs the canonical protocol. Currently: [Patrick Espino](https://github.com/Monoperro0207). |
| **Contributor** | Anyone who opens an issue, sends a patch, runs the conformance suite, or maintains a third-party SDK. |
| **Implementer** | A team that ships a Glyph-compatible server, client or adapter. Implementers' feedback is the primary input to RFCs. |

There is no formal voting body yet. Maintainer decisions are public and
appealable via an issue or RFC.

## Versioning

Two version axes are tracked **separately**:

1. **Wire protocol** — semantic. `PROTOCOL_VERSION` in `@glyphp/types`. A
   breaking wire change increments the major. Cross-version handshakes fail
   loudly with `426 PROTOCOL_VERSION_UNSUPPORTED`.
2. **Package** — independent per package, managed by `changesets`. A package
   may bump major while implementing the same wire protocol.

Wire-protocol changes go through the **RFC process** below; package-only
changes do not.

## RFC process

Substantive protocol changes (new endpoints, new error codes, schema
changes, new card fields, key/identity model changes, conformance level
changes) go through an RFC under `spec/rfcs/`.

1. Open an issue tagged `rfc-discussion` describing the problem.
2. After feedback, send a PR that adds `spec/rfcs/RFC-NNNN-<slug>.md`
   following the template of [RFC-0001](spec/rfcs/RFC-0001-key-registry.md):
   motivation, wire format, verification, compatibility, future work.
3. Maintainer triages within 1 week. Status flows `Draft → Accepted →
   Implemented` (or `Rejected` with rationale).
4. Acceptance requires:
   - A reference implementation in `packages/`,
   - JSON Schema additions under `spec/schemas/`,
   - Canonical test vectors in `spec/canonical/` when relevant,
   - Updated conformance checks under `packages/conformance/src/levels/`.

A wire-protocol RFC that lands in `Implemented` becomes part of the next
`PROTOCOL_VERSION`. The mapping is recorded in
[`CHANGELOG-PROTOCOL.md`](CHANGELOG-PROTOCOL.md).

## Conformance

Conformance is the protocol's testing contract. The suite under
`packages/conformance/` is normative — if a server passes a level there, it
gets to advertise that level in its compatibility badge.

Levels: `discovery`, `execution`, `security`, `governance`. New checks are
either drop-in (no RFC needed) or are tied to an RFC that introduced the
feature being tested.

## Changes to this document

This document is governance for governance. Substantive changes (new
roles, new processes, anything that affects who can decide what) need an
RFC. Editorial changes (wording, links, typos) can land directly.

## Trademarks

The Apache 2.0 license does not grant rights to the "Glyph Protocol" name
or branding, which remain reserved by Patrick Espino. Implementations are
free to advertise compatibility ("Glyph Protocol 1.0 compatible") via the
conformance badge.
