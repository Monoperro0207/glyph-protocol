import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { ADAPTERS, ALL_CLIENT_IDS } from './clients/index.js'
import { emitServerProject, emitTopLevelIndex } from './emitter.js'
import { importOneServer } from './importer.js'
import { type ManualOptions, manualConfig } from './manual.js'
import { emitReport } from './report.js'
import type {
  ClientId,
  ImportedServer,
  ImportOptions,
  ImportResult,
  McpServerConfig,
  SkippedServer,
} from './types.js'

export type { ImportOptions, ImportResult } from './types.js'

export interface RunImportMcpInput {
  from?: ClientId
  pick?: boolean
  manual?: ManualOptions
  options: ImportOptions
}

/**
 * Top-level orchestration: figure out which MCPs to import, connect to each
 * one, generate the per-MCP project, and produce a markdown report.
 *
 * Failure policy: skip + warn. A single bad MCP (missing env, crash,
 * timeout) never aborts the run — it goes in the "Skipped" section of the
 * report with the exact reason.
 */
export async function runImportMcp(input: RunImportMcpInput): Promise<ImportResult> {
  const configs = await resolveConfigs(input)
  if (configs.length === 0) {
    throw new Error(
      'no MCP servers to import — pass --from <client>, --command, or --url. ' +
        'Run `glyph import mcp --help` for details.',
    )
  }

  if (input.options.dryRun) {
    printDryRunPlan(configs, input.options)
    return { imported: [], skipped: [] }
  }

  await mkdir(input.options.output, { recursive: true })

  const imported: ImportedServer[] = []
  const skipped: SkippedServer[] = []
  let port = input.options.portBase

  for (const config of configs) {
    try {
      const glyphs = await importOneServer(config, input.options.timeoutMs)
      const outDir = join(input.options.output, safeDirName(config.name))
      const result = await emitServerProject(config, glyphs, port, outDir)
      imported.push(result)
      port++
      console.log(
        `[glyph] imported ${config.source}/${config.name} → ${outDir} ` +
          `(port ${result.port}, ${result.toolCount} tools)`,
      )
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      skipped.push({ config, reason })
      console.warn(`[glyph] skipped ${config.source}/${config.name}: ${reason}`)
    }
  }

  if (imported.length > 0) {
    await emitTopLevelIndex(input.options.output, imported)
  }
  const reportPath = await emitReport(input.options.output, { imported, skipped })
  console.log(`[glyph] report written to ${reportPath}`)

  return { imported, skipped, reportPath }
}

async function resolveConfigs(input: RunImportMcpInput): Promise<McpServerConfig[]> {
  if (input.manual) {
    return [manualConfig(input.manual)]
  }
  if (input.from) {
    const adapter = ADAPTERS[input.from]
    if (!adapter) throw new Error(`unknown client: ${input.from}`)
    const configs = await adapter.load()
    if (configs.length === 0) {
      throw new Error(
        `${adapter.displayName} config had no MCP servers declared at ${adapter.configPathHint}`,
      )
    }
    if (input.pick && stdin.isTTY) {
      return await pickFromList(adapter.displayName, configs)
    }
    return configs
  }
  // Interactive mode: detect everything, ask user.
  return await interactiveSelect()
}

async function interactiveSelect(): Promise<McpServerConfig[]> {
  if (!stdin.isTTY) {
    throw new Error(
      'interactive client picker requires a TTY — pass --from <client> or --command/--url',
    )
  }
  const detected: { id: ClientId; displayName: string; configs: McpServerConfig[] }[] = []
  for (const id of ALL_CLIENT_IDS) {
    const adapter = ADAPTERS[id]
    try {
      if (!(await adapter.detect())) continue
      const configs = await adapter.load()
      detected.push({ id, displayName: adapter.displayName, configs })
    } catch (e) {
      console.warn(
        `[glyph] could not read ${adapter.displayName} config: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }
  if (detected.length === 0) {
    throw new Error(
      'no supported MCP client config detected on this machine. Pass --command or --url for a manual target.',
    )
  }

  const rl = createInterface({ input: stdin, output: stdout })
  try {
    console.log('\nDetected MCP client configs:')
    detected.forEach((d, i) => {
      console.log(
        `  ${i + 1}) ${d.displayName} (${d.configs.length} server${d.configs.length === 1 ? '' : 's'})`,
      )
    })
    const pick = (await rl.question('\nImport from which? [1]: ')).trim() || '1'
    const idx = Number(pick) - 1
    const chosen = detected[idx]
    if (!chosen) throw new Error(`invalid selection: ${pick}`)
    return await pickFromList(chosen.displayName, chosen.configs, rl)
  } finally {
    rl.close()
  }
}

async function pickFromList(
  label: string,
  configs: McpServerConfig[],
  rlExisting?: ReturnType<typeof createInterface>,
): Promise<McpServerConfig[]> {
  const rl = rlExisting ?? createInterface({ input: stdin, output: stdout })
  try {
    console.log(`\n${label} MCP servers:`)
    configs.forEach((c, i) => {
      const t =
        c.transport.kind === 'stdio'
          ? `${c.transport.command} ${(c.transport.args ?? []).join(' ')}`
          : c.transport.url
      console.log(`  ${i + 1}) ${c.name} → ${t}`)
    })
    const pick = (
      await rl.question('\nWhich to import? [comma-separated indices, or "all"]: ')
    ).trim()
    if (!pick || pick.toLowerCase() === 'all') return configs
    const picks = pick
      .split(',')
      .map((p) => Number(p.trim()) - 1)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < configs.length)
    const subset = picks.map((i) => configs[i]).filter((x): x is McpServerConfig => !!x)
    if (subset.length === 0) throw new Error(`no valid selections in "${pick}"`)
    return subset
  } finally {
    if (!rlExisting) rl.close()
  }
}

function printDryRunPlan(configs: McpServerConfig[], options: ImportOptions): void {
  console.log(`\nDry run — would import ${configs.length} MCP server(s) to ${options.output}/:`)
  let port = options.portBase
  for (const c of configs) {
    const t =
      c.transport.kind === 'stdio'
        ? `${c.transport.command} ${(c.transport.args ?? []).join(' ')}`
        : c.transport.url
    console.log(`  - ${c.source}/${c.name} → port ${port}, transport ${c.transport.kind}: ${t}`)
    port++
  }
  console.log('\n(no files written — drop --dry-run to commit)')
}

function safeDirName(raw: string): string {
  return (
    raw
      .replace(/[^a-z0-9-]+/gi, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '') || 'mcp'
  )
}
