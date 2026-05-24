"""Signature verification — cards, receipts, manifests, key registries."""
from __future__ import annotations

from typing import Any, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PublicKey,
)

from .core import canonical_hash, fingerprint_key

# Fields that enter a card's canonical content (must match @glyphp/core).
_CARD_CANONICAL_FIELDS = [
    "version",
    "name",
    "intent",
    "tags",
    "cost",
    "idempotent",
    "input",
    "output",
    "examples",
    "failureModes",
    "provider",
    "attestation",
]


def _compute_glyph_id(card: dict) -> str:
    picked = {f: card.get(f) for f in _CARD_CANONICAL_FIELDS if f in card}
    return canonical_hash(picked)


def _verify_ed25519(public_key_hex: str, message: bytes, signature_hex: str) -> bool:
    try:
        pk = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        pk.verify(bytes.fromhex(signature_hex), message)
        return True
    except (InvalidSignature, ValueError):
        return False


def verify_glyph(card: dict) -> bool:
    """Verifies the card's content hash and ed25519 signature."""
    pub = card.get("publicKey")
    sig = card.get("signature")
    if not pub or not sig:
        return False
    expected_id = _compute_glyph_id(card)
    if expected_id != card.get("id"):
        return False
    return _verify_ed25519(pub, expected_id.encode("ascii"), sig)


def verify_receipt(receipt: dict) -> bool:
    """Verifies a CallReceipt against its embedded serverPublicKey."""
    pub = receipt.get("serverPublicKey")
    sig = receipt.get("signature")
    if not pub or not sig:
        return False
    base = {k: v for k, v in receipt.items() if k != "signature"}
    return _verify_ed25519(pub, canonical_hash(base).encode("ascii"), sig)


def verify_manifest(manifest: dict) -> bool:
    """Verifies an UpdateManifest against its embedded serverPublicKey."""
    pub = manifest.get("serverPublicKey")
    sig = manifest.get("signature")
    if not pub or not sig:
        return False
    base = {k: v for k, v in manifest.items() if k != "signature"}
    return _verify_ed25519(pub, canonical_hash(base).encode("ascii"), sig)


# ---- key registry ---------------------------------------------------------

def _entry_payload(entry: dict) -> str:
    return canonical_hash(
        {
            "fingerprint": entry["fingerprint"],
            "publicKey": entry["publicKey"],
            "validFrom": entry["validFrom"],
            "signedBy": entry.get("signedBy"),
        }
    )


def _registry_payload(reg: dict) -> str:
    return canonical_hash(
        {
            "registryVersion": reg["registryVersion"],
            "serverId": reg["serverId"],
            "active": reg["active"],
            "keys": reg["keys"],
            "issuedAt": reg["issuedAt"],
            "ttlSeconds": reg["ttlSeconds"],
        }
    )


def verify_key_registry(registry: dict) -> bool:
    """Verifies a KeyRegistry's chain-of-trust and outer signature."""
    if registry.get("registryVersion") != "1.0":
        return False
    by_fp: dict[str, dict] = {}
    for entry in registry["keys"]:
        if fingerprint_key(entry["publicKey"]) != entry["fingerprint"]:
            return False
        by_fp[entry["fingerprint"]] = entry
    for entry in registry["keys"]:
        if not entry.get("signedBy"):
            continue
        sig = entry.get("signature")
        if not sig:
            return False
        parent = by_fp.get(entry["signedBy"])
        if not parent:
            return False
        if not _verify_ed25519(
            parent["publicKey"], _entry_payload(entry).encode("ascii"), sig
        ):
            return False
    active = by_fp.get(registry["active"])
    if not active or active.get("revokedAt"):
        return False
    return _verify_ed25519(
        active["publicKey"],
        _registry_payload(registry).encode("ascii"),
        registry["signature"],
    )


def resolve_key(registry: dict, public_key_hex: str) -> dict:
    """Returns `{status: 'active'|'retired'|'revoked'|'unknown', entry?, reason?}`."""
    target = fingerprint_key(public_key_hex)
    for entry in registry["keys"]:
        if entry["fingerprint"] != target:
            continue
        if entry.get("revokedAt"):
            return {
                "status": "revoked",
                "entry": entry,
                "reason": entry.get("revocationReason"),
            }
        if entry.get("validUntil"):
            return {"status": "retired", "entry": entry}
        return {"status": "active", "entry": entry}
    return {"status": "unknown"}
