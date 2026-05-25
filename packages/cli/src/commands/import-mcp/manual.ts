import type { McpServerConfig } from './types.js'

export interface ManualOptions {
  command?: string
  url?: string
  bearerToken?: string
  /** Optional friendly name — defaults to a derived slug. */
  name?: string
}

/**
 * Build a single `McpServerConfig` from a manual `--command` or `--url`
 * invocation. The command string is parsed naively on whitespace; if a
 * user needs precise quoting they should pass `--url` for an HTTP server
 * or wrap the stdio command in a shell script.
 */
export function manualConfig(opts: ManualOptions): McpServerConfig {
  if (opts.url) {
    return {
      name: opts.name ?? slugFromUrl(opts.url),
      source: 'manual',
      transport: { kind: 'http', url: opts.url, bearerToken: opts.bearerToken },
    }
  }
  if (opts.command) {
    const parts = opts.command.split(/\s+/).filter(Boolean)
    if (parts.length === 0) throw new Error('manual import: --command was empty')
    const [head, ...rest] = parts as [string, ...string[]]
    return {
      name: opts.name ?? slugFromCommand(parts),
      source: 'manual',
      transport: { kind: 'stdio', command: head, args: rest },
    }
  }
  throw new Error('manual import: pass either --command or --url')
}

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'mcp-remote'
  } catch {
    return 'mcp-remote'
  }
}

function slugFromCommand(parts: string[]): string {
  // For `npx -y @modelcontextprotocol/server-filesystem` pull the last
  // recognisable token.
  const last = parts[parts.length - 1] ?? 'mcp'
  return last.split('/').pop()!.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'mcp'
}
