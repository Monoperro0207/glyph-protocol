# Production Defaults Hardening Specification

## Purpose

Ensure Glyph servers deployed in production enforce mandatory security configurations: stable key pair, authentication, rate limiting, and key registry. The `local-dev` profile remains permissive for development.

## Requirements

### Requirement: Profile Enforcement (PRODHARDEN-001)

The server MUST detect `NODE_ENV=production` and enforce hardened defaults. When `strictProduction` is true, missing required configurations SHALL prevent startup. The `local-dev` profile (default) SHALL keep current permissive behavior.

#### Scenario: Production profile passes with all configs

- GIVEN `NODE_ENV=production` and `strictProduction: true`
- AND a stable key pair, auth, rateLimit, and keyRegistry are configured
- WHEN the server starts
- THEN startup succeeds

#### Scenario: Production missing auth — error

- GIVEN `NODE_ENV=production` and `strictProduction: true`
- AND auth is not configured
- WHEN the server starts
- THEN startup fails with a descriptive error listing missing configs

#### Scenario: Production missing rate limit — error

- GIVEN `NODE_ENV=production` and `strictProduction: true`
- AND rateLimit is not configured
- WHEN the server starts
- THEN startup fails with a descriptive error

#### Scenario: Production with strictProduction disabled — warn

- GIVEN `NODE_ENV=production` and `strictProduction: false`
- AND a required config is missing
- WHEN the server starts
- THEN a warning is logged
- AND startup proceeds

#### Scenario: Local-dev profile — all optional

- GIVEN `NODE_ENV` is not `production` (or unset)
- WHEN the server starts with partial or no security config
- THEN startup succeeds without warnings

### Requirement: Scaffold Defaults (PRODHARDEN-002)

The CLI command `glyph init production-server` MUST generate a configuration that enforces all hardened defaults out of the box.

#### Scenario: Scaffold generates hardened config

- GIVEN the user runs `glyph init production-server`
- WHEN configuration files are generated
- THEN the config includes `strictProduction: true`
- AND requires stable key pair, auth, rateLimit, and keyRegistry

#### Scenario: Scaffolded config passes production startup

- GIVEN a fresh scaffolded production config
- WHEN the server starts with `NODE_ENV=production`
- THEN startup succeeds without errors or warnings
