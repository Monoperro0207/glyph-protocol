/**
 * Workspace jail for the Hermes integration sandbox.
 *
 * Separated from server.ts so the path-jail logic can be unit-tested
 * without spinning up a Glyph server. Closes the symlink-escape vector
 * (textual prefix check is not enough: `ln -s /etc/hosts workspace/x;
 * read x` would have escaped the previous implementation).
 */

import type { Stats } from 'node:fs'
import { lstat, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'

export interface JailOptions {
  /** Absolute path of the workspace root. */
  root: string
}

function escapes(real: string, root: string): boolean {
  return real !== root && !real.startsWith(root + sep)
}

/**
 * Walk a symlink chain manually until we hit a non-symlink, a missing
 * link target, or the max depth. Used as a fallback for `realpath` when
 * the chain dangles (ENOENT) — we still need to know whether the *would-
 * be* final target lives outside the workspace before we let a write
 * recreate it.
 */
async function walkChain(start: string, max = 40): Promise<string> {
  let cur = start
  for (let i = 0; i < max; i++) {
    let st: Stats | undefined
    try {
      st = await lstat(cur)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return cur
      throw e
    }
    if (!st.isSymbolicLink()) return cur
    const next = await readlink(cur)
    cur = isAbsolute(next) ? next : resolve(dirname(cur), next)
  }
  throw new Error('symlink chain too deep')
}

export function createJail({ root }: JailOptions) {
  const ROOT = resolve(root)
  let realRoot: string | null = null
  const workspaceReal = async (): Promise<string> => {
    if (realRoot !== null) return realRoot
    realRoot = await realpath(ROOT)
    return realRoot
  }

  /**
   * Resolve `input` for a READ. Follows symlinks via realpath() and
   * rejects if the resolved target lives outside the workspace root.
   */
  const jailedReadPath = async (input: string): Promise<string> => {
    const candidate = resolve(ROOT, input)
    const real = await realpath(candidate)
    const rr = await workspaceReal()
    if (escapes(real, rr)) {
      throw new Error(`path escapes workspace: ${input}`)
    }
    return real
  }

  /**
   * Resolve `input` for a WRITE. The file may not exist yet, so we
   * resolve the parent with realpath() and check that any pre-existing
   * file at the target is not a symlink that escapes.
   */
  const jailedWritePath = async (input: string): Promise<string> => {
    const candidate = resolve(ROOT, input)
    const parentReal = await realpath(dirname(candidate))
    const rr = await workspaceReal()
    if (escapes(parentReal, rr)) {
      throw new Error(`path escapes workspace: ${input}`)
    }
    const final = resolve(parentReal, basename(candidate))
    // If `final` already exists, look at it without following symlinks. If
    // it IS a symlink, follow it manually (via readlink) so we can catch the
    // case where the target does not yet exist — realpath would throw ENOENT
    // on a dangling symlink and we'd let the write through, recreating the
    // target outside the workspace.
    try {
      const s = await lstat(final)
      if (s.isSymbolicLink()) {
        // Follow the entire symlink chain. realpath() resolves the chain
        // in one go; if any link in the chain dangles we fall back to a
        // manual walk so we still catch the case where the final target
        // lives outside the workspace (audit 3: chain bypass).
        let resolved: string
        try {
          resolved = await realpath(final)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
          resolved = await walkChain(final)
        }
        if (escapes(resolved, rr)) {
          throw new Error(`path escapes workspace via symlink chain: ${input}`)
        }
      } else {
        // Regular file or dir — fall back to realpath for the existing case.
        const finalReal = await realpath(final)
        if (escapes(finalReal, rr)) {
          throw new Error(`path escapes workspace via existing symlink: ${input}`)
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      // File does not exist yet — fine for a write.
    }
    return final
  }

  return { jailedReadPath, jailedWritePath }
}
