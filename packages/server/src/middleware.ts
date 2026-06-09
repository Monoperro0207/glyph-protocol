import { createHash, timingSafeEqual } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, MiddlewareHandler } from 'hono'
import { errorResponse } from './errors.js'
import type { RateLimitStore } from './stores.js'
import { MemoryRateLimitStore } from './stores.js'

export interface AuthConfig {
  tokens?: string[]
  verify?: (token: string) => boolean
}

export interface RateLimitConfig {
  windowMs: number
  max: number
}

function bearerToken(c: Context): string {
  const header = c.req.header('Authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

/** SHA-256 hash of a string — produces fixed-length 32-byte output. */
function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest()
}

/** Resolves an AuthConfig to a single token-verification predicate. */
export function buildVerify(config: AuthConfig): (token: string) => boolean {
  if (config.verify) return config.verify

  // Constant-time token comparison: SHA-256 hashes both sides to
  // a fixed 32-byte output, then uses crypto.timingSafeEqual to
  // eliminate length and prefix-timing leaks.
  const storedHashes = (config.tokens ?? []).map((t) => sha256(t))
  return (token: string): boolean => {
    const tokenHash = sha256(token)
    for (const storedHash of storedHashes) {
      // timingSafeEqual requires equal-length buffers; SHA-256 guarantees 32.
      if (timingSafeEqual(tokenHash, storedHash)) return true
    }
    return false
  }
}

/**
 * Bearer-token auth gate. `/health` stays public so health checks keep working.
 * A transport-level gate — not a replacement for OAuth/JWT identity systems.
 */
export function authMiddleware(config: AuthConfig): MiddlewareHandler {
  const verify = buildVerify(config)
  return async (c, next) => {
    if (c.req.path === '/health') return next()
    const token = bearerToken(c)
    if (!token || !verify(token)) {
      return errorResponse(c, 401, 'UNAUTHORIZED', 'Missing or invalid bearer token')
    }
    return next()
  }
}

/**
 * Fixed-window rate limiter. Keyed by a *verified* bearer token when one is
 * present, otherwise by remote IP. `/health` is never limited.
 *
 * Pass `verifyToken` (the server does this whenever auth is configured) so an
 * unverified token cannot mint its own bucket: without it, an attacker rotates
 * fake tokens to get a fresh bucket per request and escapes the limit entirely.
 *
 * Counters live in a {@link RateLimitStore} — in-memory by default (per
 * process), or an injected shared backend so multiple replicas enforce one
 * global limit.
 */
export function rateLimitMiddleware(
  config: RateLimitConfig,
  verifyToken?: (token: string) => boolean,
  store: RateLimitStore = new MemoryRateLimitStore(),
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === '/health') return next()
    const now = Date.now()
    const key = clientKey(c, verifyToken)
    const { count, resetAt } = await store.hit(key, config.windowMs, now)
    if (count > config.max) {
      c.header('Retry-After', String(Math.ceil((resetAt - now) / 1000)))
      return errorResponse(c, 429, 'RATE_LIMITED', 'Too many requests')
    }
    return next()
  }
}

function clientKey(c: Context, verifyToken?: (token: string) => boolean): string {
  const token = bearerToken(c)
  // Only a verified token earns its own bucket. An unverified or absent token
  // falls back to the remote IP — otherwise rotating fake tokens defeats the
  // limiter completely.
  if (token && verifyToken?.(token)) return `token:${token}`
  try {
    return `ip:${getConnInfo(c).remote.address ?? 'unknown'}`
  } catch {
    return 'ip:unknown'
  }
}
