# Conformance Profiles Specification

## Purpose

Define tiered conformance profiles so deployments self-certify at the level matching their threat model, replacing binary pass/fail.

## Requirements

### Requirement: CONFPROF-001 — Profile Level Definition

The system MUST support conformance profiles that compose existing checks into named tiers.

| Profile | Scope |
|---------|-------|
| `minimal` | Discovery + execution checks |
| `secure` | Minimal + security (auth, rate limit, confirmation) |
| `production` | Secure + governance (key registry, manifest, stable key) |
| `adapter-openapi` | Adapter-specific (SSRF gate, schema compilation) |
| `adapter-mcp` | Adapter-specific (tool-name safety, annotation handling) |

The `secure` profile SHALL be the default when no `--profile` flag is supplied.

#### Scenario: Default profile is secure

- GIVEN a conformance run with no `--profile` flag
- WHEN the run executes
- THEN only `secure`-level checks execute (discovery + execution + security)
- AND governance and adapter checks are skipped

#### Scenario: Explicit minimal profile

- GIVEN `--profile minimal` is passed
- WHEN the run executes
- THEN only discovery and execution checks execute
- AND security, governance, and adapter checks are skipped

#### Scenario: Production includes all base levels

- GIVEN `--profile production` is passed
- WHEN the run executes
- THEN discovery, execution, security, AND governance checks execute
- AND adapter-specific checks are skipped

### Requirement: CONFPROF-002 — Profile Level Gating

Each profile MUST be independently passable. A deployment MAY run `minimal` without executing `secure` checks. The system MUST NOT require higher-tier checks for lower-tier profiles.

#### Scenario: Minimal passes without security checks

- GIVEN a deployment runs `--profile minimal`
- AND the deployment has no auth or rate limiting configured
- WHEN all discovery and execution checks pass
- THEN the run reports PASS for `minimal`
- AND no security-related failures are reported

#### Scenario: Production fails when governance missing

- GIVEN a deployment runs `--profile production`
- AND the deployment lacks a key registry
- WHEN governance checks execute
- THEN the run reports FAIL for `production`
- AND the failure report identifies which governance check failed

### Requirement: CONFPROF-003 — Adapter Profile Independence

Adapter profiles (`adapter-openapi`, `adapter-mcp`) MUST be additive and MUST NOT require base profiles to pass. They SHALL gate only adapter-specific checks.

#### Scenario: Adapter profile runs independently

- GIVEN `--profile adapter-openapi` is passed without any base profile
- WHEN the run executes
- THEN only OpenAPI adapter-specific checks execute (SSRF gate, schema compilation)
- AND no discovery, execution, security, or governance checks run

#### Scenario: Adapter profile failure does not block base profile

- GIVEN `--profile production --profile adapter-mcp` is passed
- WHEN the MCP adapter check fails but all production checks pass
- THEN the run reports PASS for `production`
- AND FAIL for `adapter-mcp`
