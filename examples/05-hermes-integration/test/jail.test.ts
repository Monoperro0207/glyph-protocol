import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { createJail } from '../jail.js'

let root: string
let outside: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'glyph-jail-'))
  outside = await mkdtemp(join(tmpdir(), 'glyph-outside-'))
  await mkdir(join(root, 'subdir'), { recursive: true })
  await writeFile(join(root, 'safe.txt'), 'inside')
  await writeFile(join(outside, 'secret.txt'), 'OUTSIDE-SECRET')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

test('jailedReadPath allows reads inside the workspace', async () => {
  const { jailedReadPath } = createJail({ root })
  const p = await jailedReadPath('safe.txt')
  const content = await readFile(p, 'utf8')
  assert.equal(content, 'inside')
})

test('jailedReadPath rejects ../ traversal', async () => {
  const { jailedReadPath } = createJail({ root })
  await assert.rejects(() => jailedReadPath('../../../etc/hosts'))
})

test('jailedReadPath rejects symlink to a file outside the workspace (audit H1 read)', async () => {
  await symlink(join(outside, 'secret.txt'), join(root, 'escape'))
  const { jailedReadPath } = createJail({ root })
  await assert.rejects(() => jailedReadPath('escape'), /escapes workspace/)
})

test('jailedReadPath rejects symlink to a directory outside the workspace', async () => {
  await symlink(outside, join(root, 'escape-dir'))
  const { jailedReadPath } = createJail({ root })
  await assert.rejects(() => jailedReadPath('escape-dir'), /escapes workspace/)
})

test('jailedWritePath rejects writes through a symlink pointing outside (audit H1 write)', async () => {
  await symlink(join(outside, 'target.txt'), join(root, 'outside-write'))
  const { jailedWritePath } = createJail({ root })
  await assert.rejects(() => jailedWritePath('outside-write'), /escapes workspace/)
})

test('jailedWritePath rejects writes whose parent is a symlink escaping', async () => {
  await symlink(outside, join(root, 'escape-dir'))
  const { jailedWritePath } = createJail({ root })
  await assert.rejects(() => jailedWritePath('escape-dir/new.txt'), /escapes workspace/)
})

test('jailedWritePath allows fresh file creation inside the workspace', async () => {
  const { jailedWritePath } = createJail({ root })
  const p = await jailedWritePath('subdir/new.txt')
  await writeFile(p, 'hello')
  const content = await readFile(p, 'utf8')
  assert.equal(content, 'hello')
})

test('jailedWritePath rejects writes through a symlink CHAIN escaping (audit 3)', async () => {
  // outer-link -> subdir/inner-link -> outside/target.txt
  await symlink(join(outside, 'target.txt'), join(root, 'subdir', 'inner-link'))
  await symlink(join(root, 'subdir', 'inner-link'), join(root, 'outer-link'))
  const { jailedWritePath } = createJail({ root })
  await assert.rejects(() => jailedWritePath('outer-link'), /escapes workspace/)
})

test('jailedWritePath rejects dangling symlink chain escaping (audit 3)', async () => {
  // outer-link2 -> subdir/inner-link2 -> outside/nonexistent.txt (dangling)
  await symlink(join(outside, 'nonexistent.txt'), join(root, 'subdir', 'inner-link2'))
  await symlink(join(root, 'subdir', 'inner-link2'), join(root, 'outer-link2'))
  const { jailedWritePath } = createJail({ root })
  await assert.rejects(() => jailedWritePath('outer-link2'), /escapes workspace/)
})
