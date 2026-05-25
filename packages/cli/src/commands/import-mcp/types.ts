/**
 * Normalized shape every client adapter must produce. The `transport` field
 * captures what's needed to actually connect to an MCP server: either a
 * stdio subprocess (the most common case across Claude Desktop, Cursor and
 * Codex) or a remote HTTP/SSE endpoint.
 */
export interface McpServerConfig {
  /** Human-friendly identifier the user originally gave the server. */
  name: string
  /** Which client config the entry came from, for the import report. */
  source: ClientId | 'manual'
  transport:
    | {
        kind: 'stdio'
        command: string
        args?: string[]
        env?: Record<string, string>
      }
    | { kind: 'http'; url: string; bearerToken?: string }
}

export type ClientId = 'claude-desktop' | 'cursor' | 'codex' | 'openclaw' | 'hermes-agent'

/**
 * A client adapter knows where its config file lives, whether one is
 * present on this machine, and how to parse it into the normalized shape.
 * Adapters never throw on a missing file — they return `false` from
 * `detect()`. They DO throw on a present-but-unparseable file.
 */
export interface ClientAdapter {
  id: ClientId
  displayName: string
  /** Best-effort location hint shown to the user. */
  configPathHint: string
  detect(): Promise<boolean>
  load(): Promise<McpServerConfig[]>
}

export interface ImportOptions {
  /** Output directory (default `glyph-imports`). */
  output: string
  /** First port to assign; subsequent MCPs increment. */
  portBase: number
  /** Don't write anything — print the plan and exit. */
  dryRun: boolean
  /** Per-MCP timeout for connect + listTools (ms). Default 10_000. */
  timeoutMs: number
}

export interface ImportedServer {
  config: McpServerConfig
  port: number
  toolCount: number
  cards: ImportedCard[]
  outputDir: string
}

export interface ImportedCard {
  name: string
  riskTier: 'safe' | 'caution' | 'danger'
  requiresConfirmation: boolean
}

export interface SkippedServer {
  config: McpServerConfig
  reason: string
}

export interface ImportResult {
  imported: ImportedServer[]
  skipped: SkippedServer[]
  reportPath?: string
}
