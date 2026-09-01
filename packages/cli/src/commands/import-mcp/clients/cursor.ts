import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClientAdapter, McpServerConfig } from '../types.js'
import { parseClaudeDesktopJson } from './claude-desktop.js'

/**
 * Cursor uses the same JSON shape as Claude Desktop, but reads from two
 * places — a global config and a per-project config. We merge them, with
 * per-project entries shadowing globals on name collision (matches Cursor's
 * own resolution order).
 */
function globalPath(): string {
  return join(homedir(), '.cursor', 'mcp.json')
}
function projectPath(): string {
  return join(process.cwd(), '.cursor', 'mcp.json')
}

async function tryRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export const cursorAdapter: ClientAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  configPathHint: `${globalPath()} (+ ${projectPath()})`,
  async detect() {
    return (await tryRead(globalPath())) !== null || (await tryRead(projectPath())) !== null
  },
  async load(): Promise<McpServerConfig[]> {
    const merged = new Map<string, McpServerConfig>()
    const globalRaw = await tryRead(globalPath())
    if (globalRaw) {
      for (const s of parseClaudeDesktopJson(globalRaw, 'cursor')) {
        merged.set(s.name, s)
      }
    }
    const projectRaw = await tryRead(projectPath())
    if (projectRaw) {
      for (const s of parseClaudeDesktopJson(projectRaw, 'cursor')) {
        // Per-project shadows global.
        merged.set(s.name, s)
      }
    }
    return [...merged.values()]
  },
}
