import type { Context } from 'hono'
import type { GlyphError } from '@glyph/types'

/** Stable, machine-readable error codes returned by a Glyph server. */
export type GlyphErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_CONFIRMATION'
  | 'OUTPUT_VALIDATION_FAILED'
  | 'HANDLER_ERROR'
  | 'HANDLER_TIMEOUT'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'

type ErrorStatus = 400 | 401 | 403 | 404 | 429 | 500 | 502 | 504

/** Builds a versioned GlyphError response: { error: { code, message, details? } }. */
export function errorResponse(
  c: Context,
  status: ErrorStatus,
  code: GlyphErrorCode,
  message: string,
  details?: unknown
) {
  const error: GlyphError['error'] = { code, message }
  if (details !== undefined) error.details = details
  return c.json({ error } satisfies GlyphError, status)
}
