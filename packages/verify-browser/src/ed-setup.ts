import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

/**
 * Wires a synchronous SHA-512 into `@noble/ed25519`, which ships none by
 * default. This is the provider's own documented setup step, and it is a
 * module-load side effect — the same shape `@glyphp/core` uses, but sourced
 * from `@noble/hashes` instead of `node:crypto` so it runs in a browser.
 *
 * Keeping it synchronous is deliberate: it lets `verifyGlyph` stay a sync
 * boolean, matching core's signature exactly.
 *
 * If both this package and `@glyphp/core` load in the same process (the
 * differential test does exactly that), both assign this slot. That is
 * harmless — both are correct SHA-512 — but it looks alarming without this
 * note, hence the note.
 *
 * NOTE: this package must NOT declare `"sideEffects": false`. A bundler that
 * believed it could drop this module would silently break every signature
 * check, which is the worst possible failure mode for a verifier.
 */
ed.hashes.sha512 = sha512

export { ed }
