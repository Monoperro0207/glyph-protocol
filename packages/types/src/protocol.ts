/**
 * The Glyph wire-protocol version — the contract between client and server.
 * Distinct from any npm package version. While the protocol is 0.x, every
 * minor is potentially breaking, so client and server must agree on an
 * exact match during the handshake.
 */
export const PROTOCOL_VERSION = '0.2'
