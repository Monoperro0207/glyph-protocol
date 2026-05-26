/**
 * Conformance suite — shared types.
 *
 * The suite is organised in four levels so the protocol exposes how complete
 * a server's compatibility actually is:
 *
 *   - discovery   — health, handshake, lexicon, cards.
 *   - execution   — POST /call, validation, receipts, sanitization.
 *   - security    — confirmation gate, auth, rate limit, timeouts.
 *   - governance  — manifests, key registry, card diffs.
 *
 * A server reports which levels it passes via `compatibility` in the report;
 * this is what a published Glyph compatibility badge advertises.
 */
// We deliberately do NOT use Ajv's `ValidateFunction` type here: its
// `data is T` predicate (with T defaulting to `unknown`) narrows the input
// argument to `unknown` after each call, which then collapses every `json`
// destructuring downstream to `unknown`. A plain `(value) => boolean` does
// the same runtime work without the misleading type guard.
type PlainValidator = (value: unknown) => boolean

export type ConformanceLevel = 'discovery' | 'execution' | 'security' | 'governance'

/** Preset conformance profiles that map to level subsets. */
export type ConformanceProfile = 'minimal' | 'secure' | 'production'

export const ALL_LEVELS: readonly ConformanceLevel[] = [
  'discovery',
  'execution',
  'security',
  'governance',
] as const

export interface CheckResult {
  /** Stable identifier for the check, e.g. "discovery.handshake.accept". */
  name: string
  level: ConformanceLevel
  /** `true`/`false` for passed checks; `skipped` for fixtures the server did not expose. */
  status: 'passed' | 'failed' | 'skipped'
  detail: string
}

export interface LevelSummary {
  level: ConformanceLevel
  passed: number
  failed: number
  skipped: number
  /** A level is `pass` when no check failed (skipped is allowed). */
  status: 'pass' | 'fail'
}

export interface ConformanceReport {
  baseUrl: string
  protocolVersion: string
  timestamp: string
  passed: boolean
  /** The levels the server passed in this run — eligible for the badge. */
  compatibility: ConformanceLevel[]
  levels: LevelSummary[]
  checks: CheckResult[]
}

/** A request handler — `globalThis.fetch`, or a server's in-process `fetch`. */
export type FetchLike = (req: Request) => Promise<Response> | Response

/**
 * Names of the glyphs a server-under-test exposes as fixtures. Without these
 * the execution and security levels cannot exercise real calls; they will be
 * recorded as `skipped`.
 */
export interface FixtureGlyphs {
  /** Safe, side-effect-free glyph used for round-trip and receipt tests. */
  echo?: string
  /** A glyph that always requires confirmation. */
  requiresConfirmation?: string
  /** A glyph whose handler intentionally exceeds the configured timeout. */
  slow?: string
  /** A glyph whose handler returns output that fails its declared schema. */
  invalidOutput?: string
}

export interface ConformanceOptions {
  fetch?: FetchLike
  /** Subset of levels to run. Defaults to the secure profile levels. */
  levels?: readonly ConformanceLevel[]
  /**
   * Convenience preset that maps to a level subset.
   * Takes precedence over `levels` when both are provided.
   * `minimal` = discovery+execution, `secure` = +security, `production` = +governance.
   */
  profile?: ConformanceProfile
  /** Glyph names the server-under-test exposes for execution/security checks. */
  fixtures?: FixtureGlyphs
  /** Optional bearer token if the server requires auth. */
  authToken?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any

export interface HttpResponse {
  status: number
  headers: Headers
  json: AnyJson
  text: string
}

export type HttpFn = (
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) => Promise<HttpResponse>

/** Context handed to each level implementation. */
export interface LevelContext {
  baseUrl: string
  http: HttpFn
  validators: Record<string, PlainValidator>
  fixtures: FixtureGlyphs
  authToken?: string
  /** Names of glyphs discovered via /lexicon. Populated by discovery level. */
  lexiconNames: string[]
}

export type LevelRunner = (ctx: LevelContext) => Promise<CheckResult[]>
