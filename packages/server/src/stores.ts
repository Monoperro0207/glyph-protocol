/**
 * Pluggable state stores for the parts of the server that are otherwise
 * process-local: pending confirmations and rate-limit counters.
 *
 * The in-memory defaults preserve single-instance behavior exactly. A
 * multi-replica deployment injects implementations backed by shared storage
 * (Redis, a database) so that a confirmation ticket issued by one replica can
 * be consumed on another, and the rate limit is enforced globally instead of
 * per process. See `docs/deployment.md` for a Redis example.
 */

/** A pending confirmation ticket awaiting its single-use consumption. */
export interface PendingConfirmation {
  glyphName: string
  inputHash: string
  /** Epoch milliseconds after which the ticket is invalid. */
  expiresAt: number
}

/** Backlog state reported by {@link ConfirmationStore.sweep}. */
export interface ConfirmationBacklog {
  /** Number of unexpired pending confirmations. */
  size: number
  /** Earliest expiry among them (epoch ms) — used to derive Retry-After. */
  earliestExpiresAt?: number
}

/**
 * Storage for single-use confirmation tickets (`POST /glyphs/:name/prepare` →
 * `POST /glyphs/:name/call`). Implementations MUST make `consume` atomic
 * (fetch-and-delete): two concurrent calls with the same token must not both
 * receive the entry, or a confirmation could be replayed.
 */
export interface ConfirmationStore {
  /** Stores a pending confirmation until `entry.expiresAt`. */
  put(token: string, entry: PendingConfirmation): Promise<void>
  /**
   * Atomically fetches and removes the entry for `token`. Returns `undefined`
   * when the token is unknown or already consumed. Expiry is checked by the
   * caller — a store MAY also evict expired entries on its own (e.g. TTL).
   */
  consume(token: string): Promise<PendingConfirmation | undefined>
  /** Drops expired entries and reports the current backlog. */
  sweep(now: number): Promise<ConfirmationBacklog>
}

/** In-memory {@link ConfirmationStore} — the single-instance default. */
export class MemoryConfirmationStore implements ConfirmationStore {
  private entries = new Map<string, PendingConfirmation>()

  async put(token: string, entry: PendingConfirmation): Promise<void> {
    this.entries.set(token, entry)
  }

  async consume(token: string): Promise<PendingConfirmation | undefined> {
    const entry = this.entries.get(token)
    if (entry) this.entries.delete(token)
    return entry
  }

  async sweep(now: number): Promise<ConfirmationBacklog> {
    let earliestExpiresAt: number | undefined
    for (const [token, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(token)
      } else if (earliestExpiresAt === undefined || entry.expiresAt < earliestExpiresAt) {
        earliestExpiresAt = entry.expiresAt
      }
    }
    return { size: this.entries.size, earliestExpiresAt }
  }
}

/**
 * Counter storage for the fixed-window rate limiter. Implementations SHOULD
 * make `hit` atomic (e.g. Redis `INCR` + `PEXPIRE`) so concurrent requests
 * across replicas cannot undercount.
 */
export interface RateLimitStore {
  /**
   * Records one hit for `key` in its current fixed window and returns the
   * total count in that window plus when the window resets (epoch ms).
   */
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>
}

/** In-memory {@link RateLimitStore} — the single-instance default. */
export class MemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, { count: number; resetAt: number }>()

  async hit(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<{ count: number; resetAt: number }> {
    // Sweep up to 100 expired entries per hit so the map never grows
    // unbounded. A full O(n) sweep would be too expensive per-request;
    // 100-entry batches keep amortised cost negligible while preventing leaks.
    let swept = 0
    for (const [k, entry] of this.hits) {
      if (now >= entry.resetAt) {
        this.hits.delete(k)
        if (++swept >= 100) break
      }
    }
    let entry = this.hits.get(key)
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      this.hits.set(key, entry)
    }
    entry.count++
    return { count: entry.count, resetAt: entry.resetAt }
  }
}
