import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HELP_TEXT, NON_TTY_MESSAGE, resolveStartup } from '../src/ui/bootstrap.js'

test('--help resolves to help mode regardless of tty', () => {
  assert.equal(resolveStartup({ argv: ['--help'], isTTY: true }).mode, 'help')
  assert.equal(resolveStartup({ argv: ['--help'], isTTY: false }).mode, 'help')
  assert.equal(resolveStartup({ argv: ['-h'], isTTY: true }).mode, 'help')
})

test('non-tty (piped/CI) resolves to non-tty mode and points at the one-shot CLI', () => {
  const r = resolveStartup({ argv: [], isTTY: false })
  assert.equal(r.mode, 'non-tty')
  assert.match(r.message ?? '', /glyph <command>/)
})

test('tty with no args opens the interactive shell', () => {
  assert.equal(resolveStartup({ argv: [], isTTY: true }).mode, 'interactive')
})

test('help text is plain (no ANSI escapes) and references the one-shot CLI', () => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting no ANSI escape bytes.
  assert.doesNotMatch(HELP_TEXT, /\[/)
  assert.match(HELP_TEXT, /glyph <command>/)
  assert.match(HELP_TEXT, /NO_COLOR/)
})

test('non-tty message is plain (no ANSI escapes)', () => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting no ANSI escape bytes.
  assert.doesNotMatch(NON_TTY_MESSAGE, /\[/)
})
