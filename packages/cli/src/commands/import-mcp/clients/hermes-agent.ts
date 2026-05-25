import type { ClientAdapter } from '../types.js'

/**
 * Hermes Agent (NousResearch) supports MCP but its config lives in
 * `cli-config.yaml` plus an external docs site
 * (hermes-agent.nousresearch.com/docs/user-guide/features/mcp). The YAML
 * schema for the MCP section isn't pinned in the public README. To avoid
 * shipping a parser that breaks on its next release, the adapter throws
 * "not implemented yet" and routes the user to the RFC.
 */
export const hermesAgentAdapter: ClientAdapter = {
  id: 'hermes-agent',
  displayName: 'Hermes Agent (NousResearch)',
  configPathHint: '(schema not yet verified — see spec/rfcs/RFC-0004-import-clients.md)',
  async detect() {
    return false
  },
  async load() {
    throw new Error(
      'hermes-agent: import not implemented yet — the cli-config.yaml MCP section is not publicly schema-locked. ' +
        'Track progress in spec/rfcs/RFC-0004-import-clients.md, or pass --command/--url as a manual target.'
    )
  },
}
