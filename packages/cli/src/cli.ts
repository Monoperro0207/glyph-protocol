#!/usr/bin/env node
import { runInspect } from './commands/inspect.js'
import { runVerify } from './commands/verify.js'
import { runDiffCard } from './commands/diff.js'
import { runInit } from './commands/init.js'

const HELP = `glyph — Glyph Protocol CLI

usage:
  glyph inspect <url> [glyph]    show a server's lexicon, or one glyph card
  glyph verify <file|url>        verify a glyph card's signature and content hash
  glyph diff-card <old> <new>    classify how two glyph cards differ
  glyph init [dir]               scaffold a new Glyph project
  glyph --help`

const [command, ...args] = process.argv.slice(2)

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
