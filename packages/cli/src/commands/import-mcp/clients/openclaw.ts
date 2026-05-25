import type { ClientAdapter } from '../types.js'

/**
 * OpenClaw mentions an "MCP Registry" in its README but does not publish a
 * stable config schema we could parse without shipping fragile code. The
 * adapter is registered so the CLI surface is forward-compatible, but
 * `load()` throws a clear "schema pending verification" error instead of
 * guessing. RFC-0004 tracks the path to a real implementation.
 */
export const openclawAdapter: ClientAdapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',
  configPathHint: '(schema not yet verified — see spec/rfcs/RFC-0004-import-clients.md)',
  async detect() {
    return false
  },
  async load() {
    throw new Error(
      'openclaw: import not implemented yet — the upstream config schema is not publicly documented. ' +
        'Track progress in spec/rfcs/RFC-0004-import-clients.md, or pass --command/--url as a manual target.'
    )
  },
}
