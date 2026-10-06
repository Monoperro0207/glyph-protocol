/**
 * `@glyphp/verify-browser` — Glyph verification that runs in a browser.
 *
 * Why this exists, plainly: `@glyphp/core`'s barrel re-exports the key
 * registry, which imports `node:fs/promises`, so importing `verifyGlyph` from
 * core drags Node into a browser bundle. And core's `verifyGlyph` returns a
 * `boolean`, where a UI needs *evidence* — a verification trace it can render.
 *
 * If core ever ships a browser build, this package becomes a thin re-export.
 */
export {
  CANONICAL_FIELDS,
  canonicalHash,
  canonicalize,
  computeGlyphId,
  fromHex,
  toHex,
} from './canonical.js'
export { verifyGlyph, verifyReceipt } from './verify.js'
