import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import toml from '@iarna/toml'
import type { ClientAdapter, McpServerConfig } from '../types.js'

/**
 * Codex (OpenAI CLI + IDE extension) stores its config in TOML at
 * `~/.codex/config.toml` and optionally `<cwd>/.codex/config.toml`.
 * MCP servers live under `[mcp_servers.<name>]` tables with fields
 * `command`, `args` (array), `env` (table), and `bearer_token`.
 *
 * Documented at https://developers.openai.com/codex/mcp.
 */
function globalPath(): string {
  return join(homedir(), '.codex', 'config.toml')
}
function projectPath(): string {
  return join(process.cwd(), '.codex', 'config.toml')
}

async function tryRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export const codexAdapter: ClientAdapter = {
  id: 'codex',
  displayName: 'Codex (OpenAI)',
  configPathHint: `${globalPath()} (+ ${projectPath()})`,
  async detect() {
    return (await tryRead(globalPath())) !== null || (await tryRead(projectPath())) !== null
  },
  async load(): Promise<McpServerConfig[]> {
    const merged = new Map<string, McpServerConfig>()
    const globalRaw = await tryRead(globalPath())
    if (globalRaw) {
      for (const s of parseCodexToml(globalRaw)) merged.set(s.name, s)
    }
    const projectRaw = await tryRead(projectPath())
    if (projectRaw) {
      for (const s of parseCodexToml(projectRaw)) merged.set(s.name, s)
    }
    return [...merged.values()]
  },
}

/**
 * Pure parser exported for testing. Codex TOML can use either nested table
 * syntax (`[mcp_servers.fs]\n command = ...`) or inline-table-in-array
 * variants; we only need the field names to be stable.
 */
export function parseCodexToml(raw: string): McpServerConfig[] {
  let parsed: unknown
  try {
    parsed = toml.parse(raw)
  } catch (e) {
    throw new Error(
      `failed to parse codex config as TOML: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const block = (parsed as { mcp_servers?: Record<string, unknown> } | null)?.mcp_servers ?? {}
  const out: McpServerConfig[] = []
  for (const [name, entry] of Object.entries(block)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as {
      command?: string
      args?: unknown
      env?: unknown
      bearer_token?: string
      url?: string
    }
    if (typeof e.url === 'string') {
      out.push({
        name,
        source: 'codex',
        transport: {
          kind: 'http',
          url: e.url,
          bearerToken: typeof e.bearer_token === 'string' ? e.bearer_token : undefined,
        },
      })
      continue
    }
    if (typeof e.command !== 'string') continue
    out.push({
      name,
      source: 'codex',
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
                  ([, v]) => typeof v === 'string',
                ) as [string, string][],
              )
            : undefined,
      },
    })
  }
  return out
}
