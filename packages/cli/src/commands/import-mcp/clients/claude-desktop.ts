import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import type { ClientAdapter, McpServerConfig } from '../types.js'

/**
 * Claude Desktop stores its MCP server config in a per-OS path. The schema
 * is the de-facto standard mirrored by Cursor:
 *
 *   { mcpServers: { <name>: { command, args?, env? } } }
 *
 * We don't try to follow obscure overrides — if the user has moved the
 * file, they can pass --command/--url instead.
 */
function claudeDesktopConfigPath(): string {
  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
    default:
      // Linux build is unofficial but uses XDG.
      return join(
        process.env.XDG_CONFIG_HOME ?? join(home, '.config'),
        'Claude',
        'claude_desktop_config.json'
      )
  }
}

export const claudeDesktopAdapter: ClientAdapter = {
  id: 'claude-desktop',
  displayName: 'Claude Desktop',
  configPathHint: claudeDesktopConfigPath(),
  async detect() {
    try {
      await readFile(claudeDesktopConfigPath(), 'utf8')
      return true
    } catch {
      return false
    }
  },
  async load(): Promise<McpServerConfig[]> {
    const raw = await readFile(claudeDesktopConfigPath(), 'utf8')
    return parseClaudeDesktopJson(raw, 'claude-desktop')
  },
}

/**
 * Pure parser exported for testing. Accepts the raw JSON string and the
 * source tag (Cursor reuses this with a different tag).
 */
export function parseClaudeDesktopJson(
  raw: string,
  source: 'claude-desktop' | 'cursor'
): McpServerConfig[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(
      `failed to parse ${source} config as JSON: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  const servers =
    (parsed as { mcpServers?: Record<string, unknown> } | null)?.mcpServers ?? {}
  const out: McpServerConfig[] = []
  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { command?: string; args?: unknown; env?: unknown; url?: string }
    if (typeof e.url === 'string') {
      out.push({ name, source, transport: { kind: 'http', url: e.url } })
      continue
    }
    if (typeof e.command !== 'string') {
      // Skip silently — a malformed entry shouldn't kill the whole import.
      continue
    }
    out.push({
      name,
      source,
      transport: {
        kind: 'stdio',
        command: e.command,
        args: Array.isArray(e.args)
          ? (e.args.filter((x) => typeof x === 'string') as string[])
          : undefined,
        env:
          e.env && typeof e.env === 'object'
            ? Object.fromEntries(
                Object.entries(e.env as Record<string, unknown>).filter(
                  ([, v]) => typeof v === 'string'
                ) as [string, string][]
              )
            : undefined,
      },
    })
  }
  return out
}
