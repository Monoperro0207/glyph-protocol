/**
 * The Glyph wire-protocol version — the contract between client and server.
 * Distinct from any npm package version. While the protocol is 0.x, every
 * minor is potentially breaking, so client and server must agree on an
 * exact match during the handshake.
 */
export const PROTOCOL_VERSION = '0.2'

/**
 * The wire version of the optional UpdateManifest format. Independent of
 * PROTOCOL_VERSION: the manifest is an additive, optional artifact, so its
 * evolution does not move the handshake-negotiated protocol contract.
 */
export const MANIFEST_VERSION = '0.1'
