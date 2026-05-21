import type { Context, MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { errorResponse } from './errors.js'

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

/**
 * Bearer-token auth gate. `/health` stays public so health checks keep working.
 * A transport-level gate — not a replacement for OAuth/JWT identity systems.
 */
export function authMiddleware(config: AuthConfig): MiddlewareHandler {
  const verify =
    config.verify ?? ((token: string) => (config.tokens ?? []).includes(token))
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
 * Fixed-window rate limiter, in-memory. Keyed by bearer token when present,
 * otherwise by remote IP. `/health` is never limited.
 */
export function rateLimitMiddleware(config: RateLimitConfig): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return async (c, next) => {
    if (c.req.path === '/health') return next()
    const now = Date.now()
    if (hits.size > 5000) {
      for (const [key, entry] of hits) {
        if (now >= entry.resetAt) hits.delete(key)
      }
    }
    const key = clientKey(c)
    let entry = hits.get(key)
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + config.windowMs }
      hits.set(key, entry)
    }
    entry.count++
    if (entry.count > config.max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return errorResponse(c, 429, 'RATE_LIMITED', 'Too many requests')
    }
    return next()
  }
}

function clientKey(c: Context): string {
  const token = bearerToken(c)
  if (token) return `token:${token}`
  try {
    return `ip:${getConnInfo(c).remote.address ?? 'unknown'}`
  } catch {
    return 'ip:unknown'
  }
}
