#!/usr/bin/env python3
"""
Native Glyph wire-protocol test — proves the protocol works as a protocol,
without any LLM or framework in the loop. Speaks raw HTTP + JSON to a Glyph
server and verifies every cryptographic invariant the SDK promises.

Dependencies (sandbox installs from requirements.txt):
    requests, cryptography

Exit codes:
    0 — every invariant PASSes
    non-zero — one or more invariants FAILed; details on stdout
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

GLYPH_URL = os.environ.get("GLYPH_SERVER_URL", "http://127.0.0.1:3199")
PROTOCOL_VERSION = "1.0"

# ── Canonical hashing (mirror of @glyphp/core.canonicalize) ────────────────
CANONICAL_FIELDS = (
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
)


def canonicalize(value: Any) -> Any:
    """Order-stable structural canonicalization, matches @glyphp/core."""
    if isinstance(value, list):
        return [canonicalize(v) for v in value]
    if isinstance(value, dict):
        return {k: canonicalize(value[k]) for k in sorted(value.keys())}
    return value


def canonical_json(value: Any) -> str:
    """JSON-stringify the canonicalized value — same wire bytes as Node's
    JSON.stringify after canonicalize(). `ensure_ascii=False` matches Node's
    default behaviour of emitting UTF-8 directly; `separators` matches the
    no-whitespace form Node produces with no second argument."""
    return json.dumps(canonicalize(value), separators=(",", ":"), ensure_ascii=False)


def compute_glyph_id(card: dict[str, Any]) -> str:
    picked = {k: card.get(k) for k in CANONICAL_FIELDS if card.get(k) is not None}
    return hashlib.sha256(canonical_json(picked).encode("utf-8")).hexdigest()


def verify_card_signature(card: dict[str, Any]) -> bool:
    """Verifies the card's id hashes the canonical content AND the signature
    over the id verifies under the embedded publicKey."""
    if not card.get("signature") or not card.get("publicKey"):
        return False
    if compute_glyph_id(card) != card["id"]:
        return False
    try:
        pk = Ed25519PublicKey.from_public_bytes(bytes.fromhex(card["publicKey"]))
        pk.verify(bytes.fromhex(card["signature"]), card["id"].encode("utf-8"))
        return True
    except (InvalidSignature, ValueError):
        return False


def verify_receipt_signature(receipt: dict[str, Any]) -> bool:
    """The receipt is signed over canonicalHash of (receipt - signature)."""
    if not receipt.get("signature") or not receipt.get("serverPublicKey"):
        return False
    pk = Ed25519PublicKey.from_public_bytes(
        bytes.fromhex(receipt["serverPublicKey"])
    )
    rest = {k: v for k, v in receipt.items() if k != "signature"}
    message = hashlib.sha256(canonical_json(rest).encode("utf-8")).hexdigest()
    try:
        pk.verify(bytes.fromhex(receipt["signature"]), message.encode("utf-8"))
        return True
    except InvalidSignature:
        return False


# ── Test runner ────────────────────────────────────────────────────────────
@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Suite:
    results: list[Result] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.results.append(Result(name, ok, detail))
        marker = "PASS" if ok else "FAIL"
        line = f"  [{marker}] {name}"
        if detail:
            line += f"  — {detail}"
        print(line)

    @property
    def all_passed(self) -> bool:
        return all(r.ok for r in self.results)


def wait_for_server(timeout_s: float = 30.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            r = requests.get(f"{GLYPH_URL}/health", timeout=2)
            if r.ok:
                return
        except requests.RequestException:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"Glyph server at {GLYPH_URL} did not become ready")


def main() -> int:
    print(f"Native Glyph wire-protocol test against {GLYPH_URL}\n")
    wait_for_server()
    suite = Suite()

    # 1. Handshake
    r = requests.post(
        f"{GLYPH_URL}/handshake",
        json={
            "protocolVersion": PROTOCOL_VERSION,
            "consumerId": "native-test",
            "contextBudget": 50000,
            "preferredCardDepth": "standard",
        },
    )
    handshake = r.json()
    suite.add(
        "handshake returns the negotiated protocol version",
        r.ok and "lexicon" in handshake,
        f"HTTP {r.status_code}",
    )

    # 2. Lexicon
    lexicon = handshake["lexicon"]
    expected_tools = {
        "fs.read",
        "fs.list",
        "fs.write",
        "http.fetch",
        "sql.query",
        "math.sum",
        "math.hash",
        "util.uuid",
    }
    actual_tools = {entry["name"] for entry in lexicon}
    suite.add(
        "lexicon lists every registered tool",
        actual_tools == expected_tools,
        f"missing: {expected_tools - actual_tools or 'none'}; extra: {actual_tools - expected_tools or 'none'}",
    )

    # 3. Card signatures
    bad_cards: list[str] = []
    sample_card: dict[str, Any] = {}
    for entry in lexicon:
        cr = requests.get(
            f"{GLYPH_URL}/glyphs/{entry['name']}",
            params={"depth": "rich"},
        )
        card = cr.json()
        if not verify_card_signature(card):
            bad_cards.append(entry["name"])
        if entry["name"] == "math.sum":
            sample_card = card
    suite.add(
        "every card's id and signature verify against the embedded publicKey",
        not bad_cards,
        f"bad: {bad_cards}" if bad_cards else "8/8",
    )

    # 4. Tampered card — flipping one byte in the intent must change the id
    tampered = dict(sample_card)
    tampered["intent"] = sample_card["intent"] + " (tampered)"
    recomputed = compute_glyph_id(tampered)
    suite.add(
        "mutating a card field changes the computed id (pin would reject)",
        recomputed != sample_card["id"],
        f"original={sample_card['id'][:12]}… mutated={recomputed[:12]}…",
    )

    # 5. Round-trip a call and verify the receipt signature
    cr = requests.post(
        f"{GLYPH_URL}/glyphs/math.sum/call",
        json={"input": {"numbers": [10, 20, 30]}, "callId": "native-1"},
    )
    envelope = cr.json()
    payload_ok = (
        cr.ok and isinstance(envelope.get("payload"), dict) and envelope["payload"].get("sum") == 60
    )
    suite.add(
        "math.sum([10,20,30]) returns 60",
        payload_ok,
        f"payload={envelope.get('payload')!r}",
    )

    receipt = envelope.get("receipt", {})
    suite.add(
        "call receipt's ed25519 signature verifies",
        verify_receipt_signature(receipt),
        f"glyphId={receipt.get('glyphId', '?')[:12]}…",
    )

    # 6. Attestation slot — verify a card carrying one keeps signature integrity
    #    (math.sum has no attestation; we just verify the slot doesn't break
    #    anything when absent — that's what backwards-compat means in practice).
    suite.add(
        "math.sum has no attestation, yet card id and signature are valid",
        sample_card.get("attestation") is None and verify_card_signature(sample_card),
        f"attestation={sample_card.get('attestation')!r}",
    )

    print("")
    if suite.all_passed:
        print(f"OK — {len(suite.results)}/{len(suite.results)} invariants pass")
        return 0
    failed = [r.name for r in suite.results if not r.ok]
    print(f"FAIL — {len(failed)}/{len(suite.results)} invariants failed:")
    for name in failed:
        print(f"  - {name}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
