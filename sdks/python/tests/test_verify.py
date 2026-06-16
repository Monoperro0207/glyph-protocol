"""Round-trip tests for the verification helpers."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from glyph_protocol import (
    canonical_hash,
    compute_keyless_subject_digest,
    fingerprint_key,
    resolve_key,
    verify_glyph,
    verify_key_registry,
    verify_receipt,
)


def _hex_pub(priv: Ed25519PrivateKey) -> str:
    from cryptography.hazmat.primitives import serialization

    return priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    ).hex()


def _sign(priv: Ed25519PrivateKey, message: str) -> str:
    return priv.sign(message.encode("ascii")).hex()


def _build_card(priv: Ed25519PrivateKey) -> dict:
    base = {
        "version": "1.0.0",
        "name": "echo",
        "intent": "Echoes its input",
        "tags": [],
        "cost": {
            "latency": "fast",
            "sideEffects": False,
            "reversible": True,
            "riskTier": "safe",
            "requiresConfirmation": False,
        },
        "idempotent": False,
        "input": {"type": "object"},
        "output": {"type": "object"},
        "examples": [],
        "failureModes": [],
        "provider": "test",
    }
    glyph_id = canonical_hash(base)
    pub = _hex_pub(priv)
    return {
        **base,
        "id": glyph_id,
        "publicKey": pub,
        "signature": _sign(priv, glyph_id),
        "createdAt": "2026-01-01T00:00:00.000Z",
    }


def test_verify_glyph_round_trip() -> None:
    priv = Ed25519PrivateKey.generate()
    card = _build_card(priv)
    assert verify_glyph(card) is True


def test_verify_glyph_detects_id_tamper() -> None:
    priv = Ed25519PrivateKey.generate()
    card = _build_card(priv)
    card["intent"] = "tampered"
    assert verify_glyph(card) is False


def test_verify_glyph_detects_signature_swap() -> None:
    priv = Ed25519PrivateKey.generate()
    card = _build_card(priv)
    card["signature"] = "00" * 64
    assert verify_glyph(card) is False


def test_verify_glyph_detects_required_scopes_tamper() -> None:
    priv = Ed25519PrivateKey.generate()
    card = _build_card(priv)
    card["requiredScopes"] = ["files:read"]
    assert verify_glyph(card) is False


def test_verify_receipt_round_trip() -> None:
    priv = Ed25519PrivateKey.generate()
    pub = _hex_pub(priv)
    base = {
        "receiptVersion": "0.3",
        "callId": "550e8400-e29b-41d4-a716-446655440000",
        "clientCallId": "client-call-1",
        "glyphId": "0" * 64,
        "glyphName": "echo",
        "inputHash": "1" * 64,
        "outputHash": "2" * 64,
        "inspectionHash": "3" * 64,
        "riskTier": "safe",
        "provider": "test",
        "latencyMs": 5,
        "timestamp": "2026-01-01T00:00:00.000Z",
        "serverPublicKey": pub,
    }
    sig = _sign(priv, canonical_hash(base))
    receipt = {**base, "signature": sig}
    assert verify_receipt(receipt) is True
    assert verify_receipt({**receipt, "clientCallId": "tampered"}) is False


def test_verify_key_registry_round_trip() -> None:
    priv = Ed25519PrivateKey.generate()
    pub = _hex_pub(priv)
    fp = fingerprint_key(pub)
    entry = {
        "fingerprint": fp,
        "publicKey": pub,
        "validFrom": "2026-01-01T00:00:00.000Z",
    }
    base = {
        "registryVersion": "1.0",
        "serverId": "test",
        "active": fp,
        "keys": [entry],
        "issuedAt": "2026-01-01T00:00:00.000Z",
        "ttlSeconds": 3600,
    }
    sig = _sign(priv, canonical_hash(base))
    registry = {**base, "signature": sig}
    assert verify_key_registry(registry) is True
    assert resolve_key(registry, pub)["status"] == "active"


def test_keyless_subject_digest_equals_sha256_id_without_attestation() -> None:
    priv = Ed25519PrivateKey.generate()
    card = _build_card(priv)
    expected = hashlib.sha256(card["id"].encode("ascii")).hexdigest()
    assert compute_keyless_subject_digest(card) == expected


def test_keyless_attested_card_passes_verify_glyph_and_subject_binding() -> None:
    priv = Ed25519PrivateKey.generate()
    plain = _build_card(priv)
    content = {
        k: v
        for k, v in plain.items()
        if k not in ("id", "publicKey", "signature", "createdAt")
    }
    # Producer flow (RFC-0007 §3.1): bind to the attestation-exclusive id,
    # attach the attestation, then compute the final id (which includes it).
    subject = compute_keyless_subject_digest(content)
    attested = {
        **content,
        "attestation": {"type": "glyph-keyless-v1", "payload": "PGJ1bmRsZT4="},
    }
    glyph_id = canonical_hash(attested)
    card = {
        **attested,
        "id": glyph_id,
        "publicKey": _hex_pub(priv),
        "signature": _sign(priv, glyph_id),
        "createdAt": "2026-01-01T00:00:00.000Z",
    }
    assert verify_glyph(card) is True
    # The digest is invariant to attaching the attestation — and is NOT
    # sha256 of the final id, which contains the attestation.
    assert compute_keyless_subject_digest(card) == subject
    assert (
        compute_keyless_subject_digest(card)
        != hashlib.sha256(card["id"].encode("ascii")).hexdigest()
    )
