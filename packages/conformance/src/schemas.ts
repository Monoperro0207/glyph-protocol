import { readFileSync } from 'node:fs'
import type { ValidateFunction } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'

// Schemas are bundled with this package (a copy of spec/schemas/, kept in
// sync by test/schemas.test.ts). Loaded relative to this module so it works
// both from src/ in dev and dist/ once built.
const schemasDir = new URL('../schemas/', import.meta.url)

// logger:false silences Ajv's notice about the `date-time` format, which is
// treated as an annotation here (shape conformance, not format enforcement).
const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false })

function load(file: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(new URL(file, schemasDir), 'utf8'))
  return ajv.compile(schema)
}

/** Compiled JSON Schema validators for every Glyph wire message. */
export const validators = {
  glyphCard: load('glyph-card.schema.json'),
  lexiconEntry: load('lexicon-entry.schema.json'),
  handshakeRequest: load('handshake-request.schema.json'),
  handshakeResponse: load('handshake-response.schema.json'),
  callReceipt: load('call-receipt.schema.json'),
  sealedEnvelope: load('sealed-envelope.schema.json'),
  sanitization: load('sanitization.schema.json'),
  confirmationTicket: load('confirmation-ticket.schema.json'),
  glyphError: load('glyph-error.schema.json'),
  controlMessage: load('control-message.schema.json'),
  updateManifest: load('update-manifest.schema.json'),
}
