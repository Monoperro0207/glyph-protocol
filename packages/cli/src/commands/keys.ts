import { writeFileSync } from 'node:fs'
import {
  buildKeyEntry,
  buildKeyRegistry,
  fingerprintKey,
  generateKeyPair,
  FileKeyRegistry,
  resolveKey,
  verifyKeyRegistry,
} from '@glyphp/core'
import type { KeyEntry, KeyRegistry } from '@glyphp/types'

interface KeysCommandOptions {
  file: string
  serverId?: string
  reason?: string
}

/**
 * `glyph keys init` — generates the first keypair and writes a signed
 * single-entry registry to disk. Prints the new private key on stdout so
 * the operator can persist it via secret manager.
 */
export async function runKeysInit(options: KeysCommandOptions): Promise<{
  ok: boolean
  report: string
}> {
  const serverId =
    options.serverId ??
    `glyph-${Math.random().toString(36).slice(2, 10)}.local`
  const kp = generateKeyPair()
  const entry = buildKeyEntry(kp.publicKey, new Date().toISOString())
  const registry = buildKeyRegistry({
    serverId,
    entries: [entry],
    activePrivateKey: kp.privateKey,
  })
  const file = new FileKeyRegistry(options.file)
  await file.save(registry)
  return {
    ok: true,
    report: [
      `glyph keys init — wrote ${options.file}`,
      ``,
      `  serverId:    ${serverId}`,
      `  fingerprint: ${entry.fingerprint}`,
      `  publicKey:   ${kp.publicKey}`,
      `  privateKey:  ${kp.privateKey}`,
      ``,
      `Persist the private key via a secret manager — it is required to`,
      `sign cards, receipts, and any future rotation.`,
    ].join('\n'),
  }
}

/**
 * `glyph keys rotate` — generates a new active key, authorises it with the
 * outgoing key (chain-of-trust), retires the old entry, and re-signs the
 * registry. Requires the outgoing private key via `--private-key` (the
 * operator looks it up from their secret manager).
 */
export async function runKeysRotate(
  options: KeysCommandOptions & { previousPrivateKey: string }
): Promise<{ ok: boolean; report: string }> {
  const file = new FileKeyRegistry(options.file)
  const current = await file.registry()
  const activeEntry = current.keys.find((k) => k.fingerprint === current.active)
  if (!activeEntry) {
    return { ok: false, report: 'no active key in current registry' }
  }
  const now = new Date().toISOString()
  const newKp = generateKeyPair()
  const newEntry = buildKeyEntry(newKp.publicKey, now, {
    fingerprint: activeEntry.fingerprint,
    privateKey: options.previousPrivateKey,
  })
  const retiredEntries: KeyEntry[] = current.keys.map((k) =>
    k.fingerprint === activeEntry.fingerprint ? { ...k, validUntil: now } : k
  )
  const next = buildKeyRegistry({
    serverId: current.serverId,
    entries: [...retiredEntries, newEntry],
    activePrivateKey: newKp.privateKey,
  })
  await file.save(next)
  return {
    ok: true,
    report: [
      `glyph keys rotate — registry rotated`,
      ``,
      `  previous fingerprint: ${activeEntry.fingerprint}  (retired ${now})`,
      `  new active:           ${newEntry.fingerprint}`,
      `  new publicKey:        ${newKp.publicKey}`,
      `  new privateKey:       ${newKp.privateKey}`,
      ``,
      `Update your secret manager with the new private key.`,
    ].join('\n'),
  }
}

/**
 * `glyph keys revoke <fingerprint>` — marks a key as revoked and re-signs
 * the registry with the active key. A revoked key can never be unrevoked.
 */
export async function runKeysRevoke(
  fingerprint: string,
  options: KeysCommandOptions & { activePrivateKey: string }
): Promise<{ ok: boolean; report: string }> {
  const file = new FileKeyRegistry(options.file)
  const current = await file.registry()
  const target = current.keys.find((k) => k.fingerprint === fingerprint)
  if (!target) {
    return { ok: false, report: `no key with fingerprint ${fingerprint}` }
  }
  if (fingerprint === current.active) {
    return {
      ok: false,
      report: 'cannot revoke the active key — rotate first, then revoke',
    }
  }
  const now = new Date().toISOString()
  const updated: KeyEntry[] = current.keys.map((k) =>
    k.fingerprint === fingerprint
      ? { ...k, revokedAt: now, revocationReason: options.reason }
      : k
  )
  const next = buildKeyRegistry({
    serverId: current.serverId,
    entries: updated,
    activePrivateKey: options.activePrivateKey,
  })
  await file.save(next)
  return {
    ok: true,
    report: [
      `glyph keys revoke — ${fingerprint} revoked`,
      options.reason ? `  reason: ${options.reason}` : '',
      ``,
      `Re-published registry signed by ${current.active}.`,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

/** `glyph keys list` — prints the registry contents in human form. */
export async function runKeysList(options: { file: string }): Promise<{
  ok: boolean
  report: string
}> {
  const file = new FileKeyRegistry(options.file)
  const registry = await file.registry()
  const lines: string[] = [
    `glyph keys list — ${options.file}`,
    ``,
    `  serverId:    ${registry.serverId}`,
    `  active:      ${registry.active}`,
    `  issuedAt:    ${registry.issuedAt}`,
    `  ttlSeconds:  ${registry.ttlSeconds}`,
    `  verified:    ${verifyKeyRegistry(registry) ? 'yes' : 'NO — chain or signature broken'}`,
    ``,
    `keys (${registry.keys.length}):`,
  ]
  for (const entry of registry.keys) {
    const tag = entry.revokedAt
      ? 'REVOKED'
      : entry.validUntil
        ? 'retired'
        : 'active'
    lines.push(
      `  [${tag}] ${entry.fingerprint}  validFrom=${entry.validFrom}` +
        (entry.validUntil ? `  validUntil=${entry.validUntil}` : '') +
        (entry.revokedAt ? `  revokedAt=${entry.revokedAt}` : '') +
        (entry.revocationReason ? `  reason=${entry.revocationReason}` : '') +
        (entry.signedBy ? `  signedBy=${entry.signedBy}` : '  (genesis)')
    )
  }
  return { ok: true, report: lines.join('\n') }
}
