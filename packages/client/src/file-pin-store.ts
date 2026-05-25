import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Pin } from '@glyphp/types'
import type { PinStore } from './pins.js'

/**
 * On-disk format. `version` lets a future migration change the shape without
 * guessing; `pins` is keyed by tool name so a manual edit is human-readable.
 */
interface PinFile {
  version: 1
  pins: Record<string, Pin>
}

/**
 * A {@link PinStore} that persists approvals to a single JSON file. Suitable
 * for single-process agents that need pins to survive restarts.
 *
 * Writes are atomic (write-temp + rename) so a crash mid-write cannot leave a
 * truncated file behind. Reads go through an in-memory cache that is loaded
 * lazily on the first `get`/`set`. Not safe under concurrent writers — use a
 * database-backed PinStore for that.
 */
export class FilePinStore implements PinStore {
  private readonly path: string
  private cache?: Map<string, Pin>
  private writeChain: Promise<void> = Promise.resolve()

  constructor(path: string) {
    if (!path) throw new Error('FilePinStore requires a file path')
    this.path = path
  }

  async get(toolName: string): Promise<Pin | undefined> {
    const cache = await this.load()
    return cache.get(toolName)
  }

  async set(pin: Pin): Promise<void> {
    const cache = await this.load()
    cache.set(pin.toolName, pin)
    // Serialize writes so two rapid set()s cannot race on the rename.
    this.writeChain = this.writeChain.then(() => this.flush(cache))
    return this.writeChain
  }

  /** Returns every pin currently stored, in insertion order. */
  async list(): Promise<Pin[]> {
    const cache = await this.load()
    return Array.from(cache.values())
  }

  private async load(): Promise<Map<string, Pin>> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as PinFile
      if (parsed.version !== 1 || !parsed.pins) {
        throw new Error(`${this.path} is not a v1 Glyph pin file`)
      }
      this.cache = new Map(Object.entries(parsed.pins))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = new Map()
      } else {
        throw err
      }
    }
    return this.cache
  }

  private async flush(cache: Map<string, Pin>): Promise<void> {
    const payload: PinFile = {
      version: 1,
      pins: Object.fromEntries(cache),
    }
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(tmp, this.path)
  }
}
