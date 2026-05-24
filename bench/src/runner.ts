/**
 * @glyphp/bench runner — compares "raw JSON-Schema tool calling" against
 * "Glyph mode" across one or more frontier models.
 *
 * This file is the scaffold: it loads the suite, parses CLI flags, sets up
 * the result writer, and either dry-runs the plan or dispatches to a
 * model driver. The model drivers (Anthropic / OpenAI / Google) are
 * intentionally minimal stubs — fill in `runRaw` and `runGlyph` per
 * driver before kicking off real spend.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const benchRoot = join(repoRoot, 'bench')

interface Scenario {
  id: string
  prompt: string
  dangerous: boolean
  expectedTool: string
  expectedSuccessfulCall: boolean
  scoringNote?: string
}

interface Suite {
  name: string
  description: string
  scenarios: Scenario[]
}

interface ScenarioResult {
  scenarioId: string
  model: string
  mode: 'raw' | 'glyph'
  success: boolean
  toolCalls: number
  unsafeCalls: number
  correctRejections: number
  latencyMs: number
  costUsd: number
  notes: string[]
}

interface Args {
  models: string[]
  modes: Array<'raw' | 'glyph'>
  suite: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    models: ['claude-3.5-sonnet'],
    modes: ['raw', 'glyph'],
    suite: 'agent-eval',
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--models') out.models = argv[++i].split(',').map((s) => s.trim())
    else if (a === '--modes')
      out.modes = argv[++i].split(',').map((s) => s.trim()) as Args['modes']
    else if (a === '--suite') out.suite = argv[++i]
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: bench --models <csv> --modes <csv> --suite <name> [--dry-run]'
      )
      process.exit(0)
    }
  }
  return out
}

async function loadSuite(name: string): Promise<Suite> {
  const path = join(benchRoot, 'suites', `${name}.json`)
  return JSON.parse(await readFile(path, 'utf8')) as Suite
}

/**
 * `runRaw` and `runGlyph` are intentionally stubs in this scaffold.
 * They are wired up later — once we accept real spend, each driver
 * (Anthropic / OpenAI / Google) implements them against the live SDK,
 * with `runGlyph` connecting to a fixture `GlyphServer` and `runRaw`
 * exposing the same handlers as plain JSON-Schema functions.
 *
 * Until then, the runner reports the planned work and exits.
 */
async function runRaw(_model: string, _scenario: Scenario): Promise<ScenarioResult> {
  throw new Error(
    'runRaw is not implemented yet — fill in the per-model driver before live runs'
  )
}

async function runGlyph(_model: string, _scenario: Scenario): Promise<ScenarioResult> {
  throw new Error(
    'runGlyph is not implemented yet — fill in the per-model driver before live runs'
  )
}

function requireApiKeyFor(model: string): void {
  if (model.startsWith('claude') && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required for ' + model)
  }
  if (model.startsWith('gpt') && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for ' + model)
  }
  if (model.startsWith('gemini') && !process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is required for ' + model)
  }
}

function planSummary(args: Args, suite: Suite): string {
  const totalRuns = args.models.length * args.modes.length * suite.scenarios.length
  return [
    `bench plan`,
    `  suite     : ${suite.name} (${suite.scenarios.length} scenarios)`,
    `  models    : ${args.models.join(', ')}`,
    `  modes     : ${args.modes.join(', ')}`,
    `  total runs: ${totalRuns}`,
    `  dry-run   : ${args.dryRun}`,
  ].join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const suite = await loadSuite(args.suite)
  console.log(planSummary(args, suite))

  if (args.dryRun) {
    console.log('\n--dry-run: skipping real model calls.')
    return
  }

  for (const model of args.models) requireApiKeyFor(model)

  const dateStamp = new Date().toISOString().slice(0, 10)
  const resultsDir = join(benchRoot, 'results')
  await mkdir(resultsDir, { recursive: true })

  const all: ScenarioResult[] = []
  for (const model of args.models) {
    for (const mode of args.modes) {
      const perFile: ScenarioResult[] = []
      for (const scenario of suite.scenarios) {
        const result =
          mode === 'raw'
            ? await runRaw(model, scenario)
            : await runGlyph(model, scenario)
        perFile.push(result)
        all.push(result)
      }
      const outPath = join(
        resultsDir,
        `${dateStamp}__${model.replace(/[^a-z0-9.-]/gi, '_')}__${mode}.json`
      )
      await writeFile(outPath, JSON.stringify(perFile, null, 2) + '\n')
      console.log(`  wrote ${outPath}`)
    }
  }

  const summaryPath = join(resultsDir, `${dateStamp}__summary.md`)
  await writeFile(summaryPath, renderSummary(all, suite))
  console.log(`  wrote ${summaryPath}`)
}

function renderSummary(results: ScenarioResult[], suite: Suite): string {
  const byKey = new Map<string, ScenarioResult[]>()
  for (const r of results) {
    const k = `${r.model}::${r.mode}`
    const list = byKey.get(k) ?? []
    list.push(r)
    byKey.set(k, list)
  }
  const lines: string[] = [
    `# bench summary — ${suite.name}`,
    '',
    '| Model | Mode | Success % | unsafeCalls | correctRejections | avg latency (ms) | total USD |',
    '| --- | --- | --: | --: | --: | --: | --: |',
  ]
  for (const [k, list] of byKey) {
    const [model, mode] = k.split('::')
    const success = list.filter((r) => r.success).length
    const unsafe = list.reduce((s, r) => s + r.unsafeCalls, 0)
    const refused = list.reduce((s, r) => s + r.correctRejections, 0)
    const avgLat = list.reduce((s, r) => s + r.latencyMs, 0) / list.length
    const usd = list.reduce((s, r) => s + r.costUsd, 0)
    lines.push(
      `| ${model} | ${mode} | ${((success / list.length) * 100).toFixed(1)} | ${unsafe} | ${refused} | ${avgLat.toFixed(0)} | ${usd.toFixed(4)} |`
    )
  }
  return lines.join('\n') + '\n'
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
