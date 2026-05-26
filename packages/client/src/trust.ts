import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProviderTrustEntry } from '@glyphp/types'

/**
 * ProviderTrustResolver discovers and caches trust entries for glyph
 * providers. Discovery follows a fixed chain:
 *
 * 1. **Explicit** — entries passed in the constructor.
 * 2. **Filesystem** — reads `.glyph-trust.json` from `cwd` (or
 *    `fsDiscoveryPath`).
 * 3. **HTTP** — fetches `https://{provider}/.well-known/glyph-trust`.
 *
 * The first source that returns a valid entry wins. Entries are cached
 * in-memory; subsequent resolves return the cached entry.
 *
 * ## Genesis pinning (TRUSTREG-003)
 *
 * On the first encounter of a provider the resolver pins its genesis key
 * (`entry.genesisKey` when present, otherwise the first public key in
 * `entry.publicKeys`). Subsequent resolutions for the same provider must
 * present the same genesis key — a mismatch is treated as a distrust
 * signal and returns `undefined`.
 *
 * Genesis state is per-resolver instance. Consumers that need persistence
 * across restarts should save and restore {@link getGenesisSnapshot}.
 */
export class ProviderTrustResolver {
  private cache = new Map<string, ProviderTrustEntry>()
  private genesisPins = new Map<string, string>()
  private httpDiscovery: boolean
  private fsDiscoveryPath: string
  private fetchImpl: typeof fetch

  constructor(options: {
    httpDiscovery?: boolean
    fsDiscoveryPath?: string
    explicit?: ProviderTrustEntry[]
    /**
     * Inject a fetch implementation for testing. Defaults to the global
     * `fetch`.
     */
    fetchImpl?: typeof fetch
    /**
     * Pre-seeded genesis pins, e.g. restored from a previous session or
     * injected for testing. Keys are provider identifiers; values are
     * genesis key hex strings.
     */
    genesis?: Map<string, string>
  }) {
    this.httpDiscovery = options.httpDiscovery ?? false
    this.fsDiscoveryPath = options.fsDiscoveryPath ?? process.cwd()
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch

    if (options.genesis) {
      for (const [provider, key] of options.genesis) {
        this.genesisPins.set(provider, key)
      }
    }

    for (const entry of options.explicit ?? []) {
      this.cache.set(entry.provider, entry)
    }
  }

  /**
   * Resolves a provider to its trust entry. Returns `undefined` when:
   * - No discovery source returned an entry,
   * - A genesis pin exists and the new entry does not match it.
   */
  async resolve(provider: string): Promise<ProviderTrustEntry | undefined> {
    // 1. Check in-memory cache.
    const cached = this.cache.get(provider)
    if (cached) return this.enforceGenesis(provider, cached)

    // 2. Filesystem discovery.
    const fsEntry = await this.resolveFromFilesystem(provider)
    if (fsEntry) {
      this.cache.set(provider, fsEntry)
      return this.enforceGenesis(provider, fsEntry)
    }

    // 3. HTTP discovery.
    if (this.httpDiscovery) {
      const httpEntry = await this.resolveFromHttp(provider)
      if (httpEntry) {
        this.cache.set(provider, httpEntry)
        return this.enforceGenesis(provider, httpEntry)
      }
    }

    return undefined
  }

  /** All currently known provider identifiers. */
  list(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Returns the pinned genesis key for a provider, or `undefined` if the
   * provider has never been encountered (or was never resolved
   * successfully).
   */
  getGenesis(provider: string): string | undefined {
    return this.genesisPins.get(provider)
  }

  /**
   * Returns a snapshot of the current genesis pins suitable for
   * serialisation or for injecting into a new resolver instance.
   */
  getGenesisSnapshot(): Map<string, string> {
    return new Map(this.genesisPins)
  }

  // -- private ----------------------------------------------------------------

  /**
   * If the provider is new, pin its genesis key. If it already has a pinned
   * genesis, the entry's genesis must match — otherwise this is a distrust
   * signal and we return `undefined`.
   */
  private enforceGenesis(
    provider: string,
    entry: ProviderTrustEntry,
  ): ProviderTrustEntry | undefined {
    const candidateGenesis = entry.genesisKey ?? entry.publicKeys[0] ?? undefined
    if (!candidateGenesis) return entry // nothing to pin

    const pinned = this.genesisPins.get(provider)
    if (!pinned) {
      // First encounter — pin.
      this.genesisPins.set(provider, candidateGenesis)
      return entry
    }

    if (candidateGenesis !== pinned) return undefined
    return entry
  }

  private async resolveFromFilesystem(
    provider: string,
  ): Promise<ProviderTrustEntry | undefined> {
    const path = join(this.fsDiscoveryPath, '.glyph-trust.json')
    try {
      const raw = await readFile(path, 'utf8')
      const parsed = JSON.parse(raw) as ProviderTrustEntry
      if (!this.isValidEntry(parsed)) return undefined
      if (parsed.provider === provider) return parsed
      return undefined
    } catch {
      // File missing, unreadable, or invalid JSON — that's fine.
      return undefined
    }
  }

  private async resolveFromHttp(
    provider: string,
  ): Promise<ProviderTrustEntry | undefined> {
    try {
      const url = `https://${provider}/.well-known/glyph-trust`
      const res = await this.fetchImpl(url)
      if (!res.ok) return undefined
      const parsed = (await res.json()) as ProviderTrustEntry
      if (!this.isValidEntry(parsed)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  /** Lightweight structural validation so we don't trust garbage. */
  private isValidEntry(value: unknown): value is ProviderTrustEntry {
    if (!value || typeof value !== 'object') return false
    const entry = value as Record<string, unknown>
    return (
      typeof entry.provider === 'string' &&
      entry.provider.length > 0 &&
      Array.isArray(entry.publicKeys) &&
      entry.publicKeys.length > 0 &&
      entry.publicKeys.every((k: unknown) => typeof k === 'string' && k.length > 0)
    )
  }
}
