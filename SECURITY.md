# Security Policy

## Supported versions

The Glyph Protocol project supports the **current wire-protocol minor** and
the immediately previous minor. Older versions receive only critical
security fixes.

| Wire | Status |
|---|---|
| 1.0 | Active |
| 0.2 | Critical security fixes only |
| < 0.2 | Unsupported |

Package versions follow each package's own semver line and are tracked in
its CHANGELOG.

## Reporting a vulnerability

Please **do not** open a public issue for a suspected vulnerability.

- Email: `security@glyphprotocol.dev` (alias maintained by the project's
  maintainer).
- Use the GitHub "Report a vulnerability" private advisory flow on
  https://github.com/Monoperro0207/glyph-protocol/security/advisories/new
  if you have a GitHub account.

We aim to acknowledge reports within **3 business days**, ship a fix in
the affected packages within **14 days** for high/critical issues, and
publish a coordinated advisory.

## Scope

In scope:

- Cryptographic flaws in canonicalization, hashing, signing or
  verification.
- Soundness bugs in the conformance suite.
- Auth, rate-limit, confirmation-gate or timeout bypass in the reference
  server.
- Privilege-escalation or remote code execution via adapter outputs.
- Bugs in the key registry / rotation / revocation chain.

Out of scope:

- Misuse of an example: examples are illustrative, not production-ready
  unless explicitly labelled so.
- Vulnerabilities in upstream APIs accessed via adapters (report them
  upstream).
- Issues that require a malicious operator already owning the server's
  ed25519 private key.

## Coordinated disclosure

We follow a 90-day coordinated disclosure window from the date of first
maintainer acknowledgement. Earlier disclosure is allowed when a fix has
already been released and verified by the reporter. Credits in advisories
unless the reporter requests anonymity.
