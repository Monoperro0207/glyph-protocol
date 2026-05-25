import type { ClientAdapter, ClientId } from '../types.js'
import { claudeDesktopAdapter } from './claude-desktop.js'
import { codexAdapter } from './codex.js'
import { cursorAdapter } from './cursor.js'
import { hermesAgentAdapter } from './hermes-agent.js'
import { openclawAdapter } from './openclaw.js'

export const ADAPTERS: Record<ClientId, ClientAdapter> = {
  'claude-desktop': claudeDesktopAdapter,
  cursor: cursorAdapter,
  codex: codexAdapter,
  openclaw: openclawAdapter,
  'hermes-agent': hermesAgentAdapter,
}

export const ALL_CLIENT_IDS: ClientId[] = [
  'claude-desktop',
  'cursor',
  'codex',
  'openclaw',
  'hermes-agent',
]
