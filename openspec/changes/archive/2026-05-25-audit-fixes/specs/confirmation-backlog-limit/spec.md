# Confirmation Backlog Limit Specification

## Purpose

Protect the Glyph server against unbounded growth of the pending confirmations map, which can cause denial-of-service via memory exhaustion.

## Requirements

### Requirement: Hard Backlog Limit

The server MUST enforce a configurable hard cap on pending confirmations. The sweep of expired entries MUST run unconditionally before every insertion attempt. When the limit is reached, the server MUST reject new tickets with a clear error signal.

#### Scenario: Sweep is unconditional

- GIVEN the confirmation map has any entries (even fewer than the old 1000 threshold)
- WHEN a new ticket arrives
- THEN expired entries are swept BEFORE checking the limit

#### Scenario: Backlog full returns 503

- GIVEN the map has MAX_PENDING_CONFIRMATIONS (default 10_000) non-expired entries
- WHEN a new ticket arrives
- THEN the server responds with 503 CONFIRMATION_BACKLOG_FULL
- AND includes a Retry-After header

#### Scenario: Normal operation below limit

- GIVEN the map has fewer than MAX_PENDING_CONFIRMATIONS non-expired entries
- WHEN a new ticket arrives
- THEN the ticket is added normally

#### Scenario: Configurable limit via constructor

- GIVEN the server is constructed with options.maxPendingConfirmations = 5000
- WHEN the map reaches 5000 non-expired entries
- THEN the limit applies at the custom value, not the default 10_000
