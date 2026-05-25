# Constant-Time Token Check Specification

## Purpose

Prevent timing side-channel attacks on bearer token authentication. Token comparison MUST use constant-time operations that do not leak length or prefix information.

## Requirements

### Requirement: Constant-Time Token Comparison

All bearer token verification MUST use SHA-256 hashing of both input and expected values followed by `crypto.timingSafeEqual`. The existing `Array.includes()` comparison MUST be replaced because it short-circuits on first mismatch, leaking timing information.

#### Scenario: Valid token accepted

- GIVEN server config has tokens: ["secret-abc"]
- WHEN a request includes Bearer secret-abc
- THEN the request is authenticated successfully

#### Scenario: Invalid token rejected without timing leak

- GIVEN server config has tokens: ["secret-abc"]
- WHEN a request includes Bearer wrong-token
- THEN the request is rejected with 401
- AND the comparison uses constant-time operations (no early exit)

#### Scenario: Different-length token rejected safely

- GIVEN server config has tokens: ["short"]
- WHEN a request includes Bearer a-very-long-token-that-differs
- THEN the request is rejected with 401
- AND SHA-256 hashing normalizes lengths before timingSafeEqual
