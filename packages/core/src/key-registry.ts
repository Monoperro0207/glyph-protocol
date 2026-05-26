import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { KeyEntry, KeyRegistry } from '@glyphp/types'
import * as ed from '@noble/ed25519'
import { canonicalHash } from './index.js'

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'))

export const KEY_REGISTRY_VERSION = '1.0'

/** Deterministic fingerprint of a hex ed25519 public key. */
export function fingerprintKey(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex')
}

/**
 * Canonical hash of every `KeyEntry` field except `signature` — the message
 * the parent key signs to authorise the entry. The fields are picked in a
 * fixed order so the hash is deterministic across hosts.
 */
function entrySigningPayload(entry: KeyEntry): string {
  const picked: Record<string, unknown> = {
    fingerprint: entry.fingerprint,
    publicKey: entry.publicKey,
    validFrom: entry.validFrom,
    signedBy: entry.signedBy ?? null,
  }
  return canonicalHash(picked)
}

/**
 * Canonical hash of every `KeyRegistry` field except `signature` — the
 * message the currently active key signs to authorise the entire registry.
 */
function registrySigningPayload(reg: Omit<KeyRegistry, 'signature'>): string {
  return canonicalHash({
    registryVersion: reg.registryVersion,
    serverId: reg.serverId,
    active: reg.active,
    keys: reg.keys,
    issuedAt: reg.issuedAt,
    ttlSeconds: reg.ttlSeconds,
  })
}

/**
 * Verifies the entire chain-of-trust of a `KeyRegistry`:
 *
 *  - The outer signature was produced by the entry whose fingerprint is
 *    `active`.
 *  - Every non-genesis entry has a `signature` that verifies against the
 *    `signedBy` entry's public key.
 *  - `fingerprint` matches `sha256(publicKey)` for every entry.
 *
 * Returns `true` only when every check passes.
 */
export function verifyKeyRegistry(registry: KeyRegistry): boolean {
  if (registry.registryVersion !== KEY_REGISTRY_VERSION) return false
  const byFingerprint = new Map<string, KeyEntry>()
  for (const entry of registry.keys) {
    if (fingerprintKey(entry.publicKey) !== entry.fingerprint) return false
    byFingerprint.set(entry.fingerprint, entry)
  }
  // Each non-genesis entry must verify against its signedBy.
  for (const entry of registry.keys) {
    if (!entry.signedBy) continue
    if (!entry.signature) return false
    const parent = byFingerprint.get(entry.signedBy)
    if (!parent) return false
    const ok = ed.verify(
      fromHex(entry.signature),
      new TextEncoder().encode(entrySigningPayload(entry)),
      fromHex(parent.publicKey),
    )
    if (!ok) return false
  }
  // Outer signature must verify against the active key.
  const active = byFingerprint.get(registry.active)
  if (!active) return false
  if (active.revokedAt) return false
  const outerOk = ed.verify(
    fromHex(registry.signature),
    new TextEncoder().encode(registrySigningPayload(registry)),
    fromHex(active.publicKey),
  )
  return outerOk
}

/**
 * Looks up the registry entry that vouches for a signing key. Returns the
 * entry plus a `reason` flag when the key is unusable.
 */
export type ResolveResult =
  | { status: 'active' | 'retired'; entry: KeyEntry }
  | { status: 'revoked' | 'expired' | 'not-yet-valid'; entry: KeyEntry; reason?: string }
  | { status: 'unknown' }

const asTime = (value: string): number => Date.parse(value)

export function resolveKey(
  registry: KeyRegistry,
  publicKey: string,
  at: Date = new Date(),
): ResolveResult {
  const target = fingerprintKey(publicKey)
  const now = at.getTime()
  for (const entry of registry.keys) {
    if (entry.fingerprint !== target) continue
    if (entry.revokedAt && asTime(entry.revokedAt) <= now) {
      return { status: 'revoked', entry, reason: entry.revocationReason }
    }
    if (asTime(entry.validFrom) > now) return { status: 'not-yet-valid', entry }
    if (entry.validUntil && asTime(entry.validUntil) <= now) return { status: 'expired', entry }
    if (entry.validUntil) return { status: 'retired', entry }
    return { status: 'active', entry }
  }
  return { status: 'unknown' }
}

// ---- registry builders -----------------------------------------------------

export interface BuildRegistryOptions {
  serverId: string
  /** All known keys, oldest first. The last non-revoked one is treated as active. */
  entries: KeyEntry[]
  /** Hex private key of the currently active entry (to sign the outer registry). */
  activePrivateKey: string
  ttlSeconds?: number
  issuedAt?: string
}

/**
 * Builds and signs a `KeyRegistry` from its entries + the active private key.
 * Used both at startup (single-key genesis) and during rotation/revocation.
 */
export function buildKeyRegistry(opts: BuildRegistryOptions): KeyRegistry {
  const issuedAt = opts.issuedAt ?? new Date().toISOString()
  const ttlSeconds = opts.ttlSeconds ?? 3600
  // Active key = the last entry without validUntil and without revokedAt.
  const active = [...opts.entries].reverse().find((e) => !e.validUntil && !e.revokedAt)
  if (!active) {
    throw new Error('buildKeyRegistry: no active (non-retired, non-revoked) key in entries')
  }
  const base: Omit<KeyRegistry, 'signature'> = {
    registryVersion: KEY_REGISTRY_VERSION,
    serverId: opts.serverId,
    active: active.fingerprint,
    keys: opts.entries,
    issuedAt,
    ttlSeconds,
  }
  const signature = toHex(
    ed.sign(new TextEncoder().encode(registrySigningPayload(base)), fromHex(opts.activePrivateKey)),
  )
  return { ...base, signature }
}

/**
 * Produces the signed entry that introduces a new key, authorised by an
 * existing key. The genesis entry calls this without a parent and the
 * caller drops the resulting signature/signedBy.
 */
export function buildKeyEntry(
  publicKey: string,
  validFrom: string,
  parent?: { fingerprint: string; privateKey: string },
): KeyEntry {
  const fingerprint = fingerprintKey(publicKey)
  const base: KeyEntry = {
    fingerprint,
    publicKey,
    validFrom,
    signedBy: parent?.fingerprint,
  }
  if (!parent) return base
  const signature = toHex(
    ed.sign(new TextEncoder().encode(entrySigningPayload(base)), fromHex(parent.privateKey)),
  )
  return { ...base, signature }
}

// ---- KeyRegistry sources ---------------------------------------------------

/**
 * The two operations a verification path needs from a key source:
 *
 *  - resolve a public key to its registry status,
 *  - hand back the full registry for inspection.
 *
 * Implementations include in-memory, file-backed and HTTP-backed registries.
 */
export interface KeyRegistrySource {
  resolve(publicKey: string, at?: Date): Promise<ResolveResult>
  registry(): Promise<KeyRegistry>
}

/** Simple wrapper around an already-built registry. */
export class StaticKeyRegistry implements KeyRegistrySource {
  constructor(private value: KeyRegistry) {}
  async registry(): Promise<KeyRegistry> {
    return this.value
  }
  async resolve(publicKey: string, at?: Date): Promise<ResolveResult> {
    return resolveKey(this.value, publicKey, at)
  }
  /** Replace the contained registry (used by FileKeyRegistry). */
  update(next: KeyRegistry): void {
    this.value = next
  }
}

/**
 * A registry persisted to a JSON file. Writes are atomic (write-to-temp +
 * rename), so a crash mid-write leaves the previous valid registry intact.
 */
export class FileKeyRegistry implements KeyRegistrySource {
  private cache?: KeyRegistry
  constructor(private path: string) {}

  async load(): Promise<KeyRegistry> {
    if (this.cache) return this.cache
    const raw = await readFile(this.path, 'utf8')
    const parsed = JSON.parse(raw) as KeyRegistry
    if (!verifyKeyRegistry(parsed)) {
      throw new Error(`FileKeyRegistry: signature verification failed (${this.path})`)
    }
    this.cache = parsed
    return parsed
  }

  async save(registry: KeyRegistry): Promise<void> {
    if (!verifyKeyRegistry(registry)) {
      throw new Error('FileKeyRegistry: refusing to save an unsigned registry')
    }
    const tmp = `${this.path}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
    await rename(tmp, this.path)
    this.cache = registry
  }

  async registry(): Promise<KeyRegistry> {
    return this.load()
  }

  async resolve(publicKey: string, at?: Date): Promise<ResolveResult> {
    return resolveKey(await this.load(), publicKey, at)
  }
}

/**
 * A registry fetched from a remote Glyph server's `GET /keys` endpoint.
 * Caches the response for at most `min(ttlSeconds, maxAge)` and refetches
 * after that. Verifies the chain-of-trust on every fresh fetch.
 */
export class HttpKeyRegistry implements KeyRegistrySource {
  private cache?: { value: KeyRegistry; expiresAt: number }
  constructor(
    private baseUrl: string,
    private options: { maxAgeSeconds?: number; fetchImpl?: typeof fetch } = {},
  ) {}

  async registry(): Promise<KeyRegistry> {
    const now = Date.now()
    if (this.cache && this.cache.expiresAt > now) return this.cache.value
    const f = this.options.fetchImpl ?? fetch
    const res = await f(`${this.baseUrl.replace(/\/$/, '')}/keys`)
    if (!res.ok) {
      throw new Error(`HttpKeyRegistry: GET /keys returned ${res.status} ${res.statusText}`)
    }
    const parsed = (await res.json()) as KeyRegistry
    if (!verifyKeyRegistry(parsed)) {
      throw new Error('HttpKeyRegistry: signature verification failed')
    }
    const ttl = Math.min(parsed.ttlSeconds, this.options.maxAgeSeconds ?? 3600)
    this.cache = { value: parsed, expiresAt: now + ttl * 1000 }
    return parsed
  }

  async resolve(publicKey: string, at?: Date): Promise<ResolveResult> {
    return resolveKey(await this.registry(), publicKey, at)
  }
}
