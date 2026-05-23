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
  glyph --help

Pins are stored at ~/.glyph/pins.json by default. Use --file to keep a
project-local store.`

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
      console.log(await runInit(args[0] ?? '.'))
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
