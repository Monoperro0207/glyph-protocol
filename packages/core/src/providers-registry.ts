import type { PublicProvidersRegistry } from '@glyphp/types'
import * as ed from '@noble/ed25519'
import { canonicalHash } from './index.js'

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'))

export const PROVIDERS_REGISTRY_VERSION = '1.0'

/**
 * Canonical hash of every registry field except `signature` — the message the
 * issuer's key signs to authorise the whole directory (RFC-0003).
 */
function registrySigningPayload(reg: Omit<PublicProvidersRegistry, 'signature'>): string {
  return canonicalHash({
    registryVersion: reg.registryVersion,
    registryId: reg.registryId,
    issuedAt: reg.issuedAt,
    ttlSeconds: reg.ttlSeconds,
    providers: reg.providers,
    signedBy: reg.signedBy,
  })
}

/** Signs a public providers registry with the issuer's ed25519 private key. */
export function signProvidersRegistry(
  registry: Omit<PublicProvidersRegistry, 'signature'>,
  privateKey: string,
): string {
  const message = new TextEncoder().encode(registrySigningPayload(registry))
  return toHex(ed.sign(message, fromHex(privateKey)))
}

/**
 * Verifies a public providers registry (RFC-0003). The signature must verify
 * against the embedded `signedBy.publicKey`, and — when a `trustRoot` is given
 * — that key must equal the root the consumer pinned out of band. A registry
 * with no pinned root verifies only self-consistency; callers that mean to
 * *trust* the directory MUST pass `trustRoot`.
 */
export function verifyProvidersRegistry(
  registry: PublicProvidersRegistry,
  opts?: { trustRoot?: string },
): boolean {
  if (!registry.signature || !registry.signedBy?.publicKey) return false
  if (registry.registryVersion !== PROVIDERS_REGISTRY_VERSION) return false
  if (opts?.trustRoot && opts.trustRoot !== registry.signedBy.publicKey) return false
  const { signature, ...rest } = registry
  try {
    const message = new TextEncoder().encode(registrySigningPayload(rest))
    return ed.verify(fromHex(signature), message, fromHex(registry.signedBy.publicKey))
  } catch {
    return false
  }
}
