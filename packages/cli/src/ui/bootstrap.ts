/**
 * Startup resolution for the `glyphp` interactive shell. Kept pure (no I/O, no
 * Ink) so it can be unit-tested: the entry point feeds it argv + tty state and
 * acts on the returned mode.
 */

export type StartupMode = 'help' | 'non-tty' | 'interactive'

export interface StartupResult {
  mode: StartupMode
  /** Plain-text output for the non-interactive modes (`help`, `non-tty`). */
  message?: string
}

/** Plain, color-free help — also serves NO_COLOR and piped consumers. */
export const HELP_TEXT = `glyphp — interactive shell for the Glyph Protocol

Usage:
  glyphp            open the interactive shell (requires a TTY)
  glyphp --help     show this help

Inside the shell:
  ↑/↓ or j/k        move        enter   open        esc/q   back / quit

For scripting and CI use the one-shot CLI instead:
  glyph <command>   inspect · verify · diff-card · pins · approve · keys · import mcp

Respects NO_COLOR.`

/** Shown when stdout is not a TTY (piped, redirected, CI) — points at `glyph`. */
export const NON_TTY_MESSAGE = `glyphp needs an interactive terminal (TTY) and stdout is not one.
For non-interactive use, run the one-shot CLI instead: glyph <command>
(try \`glyph --help\`). Run \`glyphp --help\` for shell usage.`

export function resolveStartup({ argv, isTTY }: { argv: string[]; isTTY: boolean }): StartupResult {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { mode: 'help', message: HELP_TEXT }
  }
  if (!isTTY) {
    return { mode: 'non-tty', message: NON_TTY_MESSAGE }
  }
  return { mode: 'interactive' }
}
