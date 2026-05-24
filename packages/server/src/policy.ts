import type { Context } from 'hono'

/**
 * The principal that called the server, as resolved from the incoming
 * request. The server doesn't care *how* the principal is established
 * (JWT, bearer-token lookup, mTLS, header forwarded by an upstream gateway,
 * …) — only that it carries the caller's scopes and optional tenant.
 *
 * See `spec/rfcs/RFC-0002-policy-layer.md`.
 */
export interface CallerPrincipal {
  /** Stable identifier for the caller — opaque to the server, logged. */
  id?: string
  /** Scopes the caller has been granted by whatever issued the principal. */
  scopes: string[]
  /** Optional tenant id, exposed to the handler via `ctx.tenant`. */
  tenant?: string
}

/**
 * Resolves the caller principal from a Hono request context. Returns
 * `undefined` when no principal can be resolved — the server falls back
 * to "anonymous, no scopes" and any glyph declaring `requiredScopes` is
 * rejected with `403 INSUFFICIENT_SCOPE`.
 */
export type PolicyResolver = (c: Context) =>
  | CallerPrincipal
  | undefined
  | Promise<CallerPrincipal | undefined>

/** Returns the scopes the caller is missing for a given glyph card. */
export function missingScopes(
  required: readonly string[] | undefined,
  caller: CallerPrincipal | undefined
): string[] {
  if (!required || required.length === 0) return []
  const have = new Set(caller?.scopes ?? [])
  return required.filter((s) => !have.has(s))
}
