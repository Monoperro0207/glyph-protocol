#!/usr/bin/env node
import { render } from 'ink'
import { App } from './ui/App.js'
import { resolveStartup } from './ui/bootstrap.js'

// `glyphp` boots the full interactive shell. The one-shot `glyph <command>`
// binary is unchanged and remains the path for scripting and CI.
const startup = resolveStartup({
  argv: process.argv.slice(2),
  isTTY: Boolean(process.stdout.isTTY),
})

if (startup.mode === 'interactive') {
  render(<App />)
} else {
  // `--help` and the non-TTY fallback both print plain text and exit cleanly
  // so piped/CI invocations never hang on an interactive render.
  console.log(startup.message)
}
