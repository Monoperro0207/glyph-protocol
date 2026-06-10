"""Cross-language compatibility tests against `spec/canonical/`.

If any of these fail, the Python SDK has drifted from the canonical TS
reference — re-run `pnpm exec node scripts/generate-vectors.mjs` and diff.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from glyph_protocol import canonical_hash, sanitize
from glyph_protocol.core import canonical_bytes


REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = REPO_ROOT / "spec" / "canonical"


def _load(name: str) -> dict:
    with open(VECTORS / name, "r", encoding="utf-8") as f:
        return json.load(f)


def _case_input(case: dict):
    """Cases carrying raw JSON text (`inputJson`) are parsed here, so this
    SDK's own parser + serializer are what the vector exercises
    (spec/protocol.md §8.1)."""
    if "inputJson" in case:
        return json.loads(case["inputJson"])
    return case["input"]


@pytest.mark.parametrize("case", _load("canonicalize-vectors.json")["cases"])
def test_canonicalize_matches_reference(case: dict) -> None:
    expected = case["canonical"].encode("utf-8")
    assert canonical_bytes(_case_input(case)) == expected


@pytest.mark.parametrize("case", _load("hashing-vectors.json")["cases"])
def test_hashing_matches_reference(case: dict) -> None:
    assert canonical_hash(_case_input(case)) == case["sha256"]


@pytest.mark.parametrize("case", _load("signature-vectors.json")["cases"])
def test_signature_matches_reference(case: dict) -> None:
    # ed25519 is deterministic — same key + message must produce the
    # same signature bytes across SDKs.
    priv = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(case["privateKey"]))
    sig = priv.sign(case["message"].encode("utf-8"))
    assert sig.hex() == case["signature"]
    pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(case["publicKey"]))
    pub.verify(bytes.fromhex(case["signature"]), case["message"].encode("utf-8"))


@pytest.mark.parametrize("case", _load("sanitize-vectors.json")["cases"])
def test_sanitize_matches_reference(case: dict) -> None:
    result = sanitize(case["input"])
    assert result["value"] == case["output"]
    assert result["report"] == case["report"]
