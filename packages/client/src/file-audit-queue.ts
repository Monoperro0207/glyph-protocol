import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PendingAuditEntry, PendingAuditQueue } from './audit-queue.js'

/**
 * On-disk format. `version` lets a future migration change the shape; `entries`
 * is keyed by tool name so a manual edit stays human-readable.
 */
interface AuditQueueFile {
  version: 1
  entries: Record<string, PendingAuditEntry>
}

/**
 * A {@link PendingAuditQueue} that persists parked updates to a single JSON
 * file, so a separate process (e.g. the `glyph audit` CLI) can inspect what an
 * agent has queued. Writes are atomic (write-temp + rename); reads go through a
 * lazily-loaded in-memory cache. Not safe under concurrent writers.
 */
export class FilePendingAuditQueue implements PendingAuditQueue {
  private readonly path: string
  private cache?: Map<string, PendingAuditEntry>
  private writeChain: Promise<void> = Promise.resolve()

  constructor(path: string) {
    if (!path) throw new Error('FilePendingAuditQueue requires a file path')
    this.path = path
  }

  async enqueue(entry: PendingAuditEntry): Promise<void> {
    const cache = await this.load()
    cache.set(entry.toolName, entry)
    this.writeChain = this.writeChain.then(() => this.flush(cache))
    return this.writeChain
  }

  async get(toolName: string): Promise<PendingAuditEntry | undefined> {
    const cache = await this.load()
    return cache.get(toolName)
  }

  async list(): Promise<PendingAuditEntry[]> {
    const cache = await this.load()
    return Array.from(cache.values())
  }

  async remove(toolName: string): Promise<void> {
    const cache = await this.load()
    if (cache.delete(toolName)) {
      this.writeChain = this.writeChain.then(() => this.flush(cache))
      return this.writeChain
    }
  }

  private async load(): Promise<Map<string, PendingAuditEntry>> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as AuditQueueFile
      if (parsed.version !== 1 || !parsed.entries) {
        throw new Error(`${this.path} is not a v1 Glyph pending-audit file`)
      }
      this.cache = new Map(Object.entries(parsed.entries))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = new Map()
      } else {
        throw err
      }
    }
    return this.cache
  }

  private async flush(cache: Map<string, PendingAuditEntry>): Promise<void> {
    const payload: AuditQueueFile = {
      version: 1,
      entries: Object.fromEntries(cache),
    }
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(tmp, this.path)
  }
}
