#!/usr/bin/env node
import { runInspect } from './commands/inspect.js'
import { runVerify } from './commands/verify.js'
import { runDiffCard } from './commands/diff.js'
import { runInit } from './commands/init.js'
import {
  runPinsList,
  runPinsApprove,
  runPinsRevoke,
} from './commands/pins.js'
import { runManifestVerify } from './commands/manifest.js'
import {
  runKeysInit,
  runKeysList,
  runKeysRevoke,
  runKeysRotate,
} from './commands/keys.js'
import { runImportMcp } from './commands/import-mcp/index.js'
import { ALL_CLIENT_IDS } from './commands/import-mcp/clients/index.js'
import type { ClientId } from './commands/import-mcp/types.js'

const HELP = `glyph — Glyph Protocol CLI

usage:
  glyph inspect <url> [glyph]    show a server's lexicon, or one glyph card
  glyph verify <file|url>        verify a glyph card's signature and content hash
  glyph diff-card <old> <new>    classify how two glyph cards differ
  glyph pins list                list every pinned tool and its status
  glyph approve <card>           approve a card after review (writes a pin)
                                 flags: --reinstate, --file <pin-store-path>
  glyph revoke <tool>            revoke a previously approved tool
                                 flags: --reason <text>, --file <pin-store-path>
  glyph manifest verify <src>    verify an update manifest's signature
  glyph init [dir]               scaffold a new Glyph project
                                 flags: --profile <production-server|agent-ts|mcp-bridge|
                                                   openapi-wrapper|python-client|local-dev>
                                 (prompts interactively on a TTY when --profile is omitted)
  glyph import mcp               auto-map MCP servers from a client config or manual target
                                 flags: --from <claude-desktop|cursor|codex|openclaw|hermes-agent>,
                                        --pick, --command <stdio>, --url <http>, --bearer-token,
                                        --output <dir>, --port-base <n>, --timeout-ms <n>, --dry-run
                                 (interactive when no --from / --command / --url is passed)
  glyph keys init                generate the first keypair + registry
                                 flags: --file <path> (defaults to keys.json),
                                        --server-id <id>
  glyph keys rotate              rotate the active key — requires the previous
                                 private key via --previous-private-key <hex>
  glyph keys revoke <fingerprint>
                                 revoke a key (cannot be the active one)
                                 flags: --active-private-key <hex>, --reason <text>
  glyph keys list                show the registry contents
  glyph --help

Pins are stored at ~/.glyph/pins.json by default. Use --file to keep a
project-local store.

Key registry is stored at ./keys.json by default. See RFC-0001 for details.`

const argv = process.argv.slice(2)
const [command, ...args] = argv

/** Parses --flag and --flag value pairs out of args, returning the rest. */
function parseFlags(
  raw: string[],
  withValue: string[] = []
): { rest: string[]; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {}
  const rest: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]!
    if (token.startsWith('--')) {
      const name = token.slice(2)
      if (withValue.includes(name)) {
        const value = raw[++i]
        if (value === undefined) fail(`--${name} requires a value`)
        flags[name] = value
      } else {
        flags[name] = true
      }
    } else {
      rest.push(token)
    }
  }
  return { rest, flags }
}

try {
  switch (command) {
    case 'inspect': {
      if (!args[0]) fail('inspect requires a server URL')
      console.log(await runInspect(args[0], args[1]))
      break
    }
    case 'verify': {
      if (!args[0]) fail('verify requires a file path or URL')
      const { ok, report } = await runVerify(args[0])
      console.log(report)
      process.exit(ok ? 0 : 1)
      break
    }
    case 'diff-card': {
      if (!args[0] || !args[1]) {
        fail('diff-card requires two card sources (file or URL)')
      }
      const { ok, report } = await runDiffCard(args[0], args[1])
      console.log(report)
      process.exit(ok ? 0 : 1)
      break
    }
    case 'pins': {
      const { rest, flags } = parseFlags(args, ['file'])
      const sub = rest[0]
      if (sub !== 'list') fail('pins list is the only subcommand for now')
      const { ok, report } = await runPinsList({
        file: flags.file as string | undefined,
      })
      console.log(report)
      process.exit(ok ? 0 : 1)
      break
    }
    case 'approve': {
      const { rest, flags } = parseFlags(args, ['file'])
      if (!rest[0]) fail('approve requires a card source (file or URL)')
      const { ok, report } = await runPinsApprove(rest[0]!, {
        file: flags.file as string | undefined,
        reinstate: Boolean(flags.reinstate),
      })
      console.log(report)
      process.exit(ok ? 0 : 1)
      break
    }
    case 'revoke': {
      const { rest, flags } = parseFlags(args, ['file', 'reason'])
      if (!rest[0]) fail('revoke requires a tool name')
      const { ok, report } = await runPinsRevoke(rest[0]!, {
        file: flags.file as string | undefined,
        reason: flags.reason as string | undefined,
      })
      console.log(report)
      process.exit(ok ? 0 : 1)
      break
    }
    case 'manifest': {
      const sub = args[0]
      if (sub !== 'verify') fail('manifest verify is the only subcommand')
      if (!args[1]) fail('manifest verify requires a file path or URL')
      const { ok, report } = await runManifestVerify(args[1])
      console.log(report)
      process.exit(ok ? 0 : 1)
      break
    }
    case 'init': {
      const { rest, flags } = parseFlags(args, ['profile'])
      const dir = rest[0] ?? '.'
      let profile = flags.profile as
        | 'local-dev'
        | 'production-server'
        | 'agent-ts'
        | 'mcp-bridge'
        | 'openapi-wrapper'
        | 'python-client'
        | 'consumer-agent'
        | undefined
      // Interactive picker — only when the caller didn't pass --profile
      // AND stdin is an actual TTY (so CI/scripted use keeps the default).
      if (!profile && process.stdin.isTTY) {
        const { promptInitProfile } = await import('./commands/init.js')
        profile = await promptInitProfile()
      }
      console.log(await runInit(dir, { profile }))
      break
    }
    case 'import': {
      const sub = args[0]
      if (sub !== 'mcp') fail('import mcp is the only subcommand for now')
      const { flags } = parseFlags(args.slice(1), [
        'from',
        'command',
        'url',
        'bearer-token',
        'output',
        'port-base',
        'timeout-ms',
        'name',
      ])
      const from = flags.from as string | undefined
      if (from && !ALL_CLIENT_IDS.includes(from as ClientId)) {
        fail(`--from must be one of: ${ALL_CLIENT_IDS.join(', ')}`)
      }
      const manualCommand = flags.command as string | undefined
      const manualUrl = flags.url as string | undefined
      const manual = manualCommand || manualUrl
        ? {
            command: manualCommand,
            url: manualUrl,
            bearerToken: flags['bearer-token'] as string | undefined,
            name: flags.name as string | undefined,
          }
        : undefined
      const portBase = flags['port-base']
        ? Number(flags['port-base'] as string)
        : 3100
      const timeoutMs = flags['timeout-ms']
        ? Number(flags['timeout-ms'] as string)
        : 10_000
      if (!Number.isFinite(portBase) || portBase < 1 || portBase > 65535) {
        fail(`--port-base must be a valid port`)
      }
      if (!Number.isFinite(timeoutMs) || timeoutMs < 100) {
        fail(`--timeout-ms must be ≥ 100`)
      }
      const result = await runImportMcp({
        from: from as ClientId | undefined,
        pick: Boolean(flags.pick),
        manual,
        options: {
          output: (flags.output as string | undefined) ?? 'glyph-imports',
          portBase,
          dryRun: Boolean(flags['dry-run']),
          timeoutMs,
        },
      })
      if (!flags['dry-run']) {
        console.log(
          `\n[glyph] done — ${result.imported.length} imported, ${result.skipped.length} skipped.`
        )
      }
      break
    }
    case 'keys': {
      const { rest, flags } = parseFlags(args, [
        'file',
        'server-id',
        'previous-private-key',
        'active-private-key',
        'reason',
      ])
      const sub = rest[0]
      const file = (flags.file as string | undefined) ?? './keys.json'
      if (sub === 'init') {
        const { ok, report } = await runKeysInit({
          file,
          serverId: flags['server-id'] as string | undefined,
        })
        console.log(report)
        process.exit(ok ? 0 : 1)
      }
      if (sub === 'rotate') {
        const previousPrivateKey = flags['previous-private-key'] as
          | string
          | undefined
        if (!previousPrivateKey) {
          fail('keys rotate requires --previous-private-key <hex>')
        }
        const { ok, report } = await runKeysRotate({
          file,
          previousPrivateKey,
        })
        console.log(report)
        process.exit(ok ? 0 : 1)
      }
      if (sub === 'revoke') {
        const fingerprint = rest[1]
        if (!fingerprint) fail('keys revoke requires a fingerprint')
        const activePrivateKey = flags['active-private-key'] as
          | string
          | undefined
        if (!activePrivateKey) {
          fail('keys revoke requires --active-private-key <hex>')
        }
        const { ok, report } = await runKeysRevoke(fingerprint, {
          file,
          activePrivateKey,
          reason: flags.reason as string | undefined,
        })
        console.log(report)
        process.exit(ok ? 0 : 1)
      }
      if (sub === 'list') {
        const { ok, report } = await runKeysList({ file })
        console.log(report)
        process.exit(ok ? 0 : 1)
      }
      fail('keys <init|rotate|revoke|list>')
      break
    }
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP)
      break
    default:
      fail(`unknown command: ${command}`)
  }
} catch (err) {
  console.error(`glyph: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

function fail(message: string): never {
  console.error(`glyph: ${message}\n`)
  console.error(HELP)
  process.exit(2)
}
