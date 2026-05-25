import type { Context } from 'hono'
import type { GlyphError } from '@glyphp/types'

/** Stable, machine-readable error codes returned by a Glyph server. */
export type GlyphErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_CONFIRMATION'
  | 'CONFIRMATION_BACKLOG_FULL'
  | 'OUTPUT_VALIDATION_FAILED'
  | 'HANDLER_ERROR'
  | 'HANDLER_TIMEOUT'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_SCOPE'
  | 'RATE_LIMITED'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'MALFORMED_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR'

type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 426 | 429 | 500 | 502 | 503 | 504

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
