import type { Pin } from '@glyphp/types'

/**
 * Where a consumer keeps its approved-card pins. A pin records that a specific
 * card was reviewed and approved for a tool name; on a later handshake a tool
 * whose card no longer matches its pin is treated as unapproved.
 *
 * The default {@link MemoryPinStore} is per-process. Supply a persistent
 * implementation (file, database) to keep approvals across restarts. Methods
 * may be sync or async.
 */
export interface PinStore {
  get(toolName: string): Promise<Pin | undefined> | Pin | undefined
  set(pin: Pin): Promise<void> | void
}

/** A per-process, non-persistent PinStore — approvals are lost on restart. */
export class MemoryPinStore implements PinStore {
  private pins = new Map<string, Pin>()

  get(toolName: string): Pin | undefined {
    return this.pins.get(toolName)
  }

  set(pin: Pin): void {
    this.pins.set(pin.toolName, pin)
  }
}
