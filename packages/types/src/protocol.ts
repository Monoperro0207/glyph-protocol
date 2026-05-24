/**
 * The Glyph wire-protocol version — the contract between client and server.
 * Distinct from any npm package version. Client and server must agree on an
 * exact match during the handshake (`426 PROTOCOL_VERSION_UNSUPPORTED` on
 * mismatch). 1.0 is the first stable line — see CHANGELOG-PROTOCOL.md for
 * what changed since 0.2.
 */
export const PROTOCOL_VERSION = '1.0'

/**
 * The wire version of the optional UpdateManifest format. Independent of
 * PROTOCOL_VERSION: the manifest is an additive, optional artifact, so its
 * evolution does not move the handshake-negotiated protocol contract.
 */
export const MANIFEST_VERSION = '0.1'
