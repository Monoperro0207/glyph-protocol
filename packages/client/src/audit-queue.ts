import type { CardDiff, GlyphCard } from '@glyphp/types'

/**
 * A tool update that was detected but not yet audited/approved. While an entry
 * sits in the queue the consumer keeps running the tool's last approved
 * (stable) pin — the new card is never executed until it is audited and
 * promoted. See FASE 1 of the roadmap: fail-to-last-known-good.
 */
export interface PendingAuditEntry {
  toolName: string
  /** The newly-seen card that has not yet been audited or approved. */
  newCard: GlyphCard
  /** The diff from the stable pinned card to the new card. */
  diff: CardDiff
  /** ISO timestamp when the change was first detected. */
  detectedAt: string
}

/**
 * Where a resilient-update consumer parks tool updates awaiting audit. Keyed by
 * tool name: a later change to the same tool replaces the pending entry, since
 * only the most recent unaudited card matters. Methods may be sync or async,
 * mirroring {@link PinStore}.
 */
export interface PendingAuditQueue {
  enqueue(entry: PendingAuditEntry): Promise<void> | void
  get(toolName: string): Promise<PendingAuditEntry | undefined> | PendingAuditEntry | undefined
  list(): Promise<PendingAuditEntry[]> | PendingAuditEntry[]
  remove(toolName: string): Promise<void> | void
}

/** A per-process, non-persistent PendingAuditQueue. */
export class MemoryPendingAuditQueue implements PendingAuditQueue {
  private entries = new Map<string, PendingAuditEntry>()

  enqueue(entry: PendingAuditEntry): void {
    this.entries.set(entry.toolName, entry)
  }

  get(toolName: string): PendingAuditEntry | undefined {
    return this.entries.get(toolName)
  }

  list(): PendingAuditEntry[] {
    return [...this.entries.values()]
  }

  remove(toolName: string): void {
    this.entries.delete(toolName)
  }
}
