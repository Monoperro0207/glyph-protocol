"""Pure functions — canonicalization, hashing, sanitization, fingerprints.

These mirror @glyphp/core exactly. Cross-language compatibility is verified
against `spec/canonical/*-vectors.json` in the test suite.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any


def canonicalize(value: Any) -> Any:
    """Sort object keys and recurse into lists. Preserves primitive types.

    Matches the TypeScript `canonicalize()` — JSON.stringify of the result
    is the canonical pre-image of the SHA-256 hash.
    """
    if isinstance(value, dict):
        return {k: canonicalize(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [canonicalize(v) for v in value]
    return value


def canonical_bytes(value: Any) -> bytes:
    """Canonical UTF-8 bytes of a JSON value (without trailing newline).

    Uses `separators=(',', ':')` and `ensure_ascii=False` to match Node's
    `JSON.stringify` defaults exactly.
    """
    return json.dumps(
        canonicalize(value),
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def canonical_hash(value: Any) -> str:
    """SHA-256 hex of `canonical_bytes(value)`."""
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def fingerprint_key(public_key_hex: str) -> str:
    """SHA-256 fingerprint of a hex ed25519 public key (matches @glyphp/core)."""
    return hashlib.sha256(public_key_hex.encode("ascii")).hexdigest()


# ---- sanitization ----------------------------------------------------------
#
# Mirrors @glyphp/core `sanitize()`. The same Unicode categories are removed
# in the same order so the inspection report is byte-identical across SDKs.

# Tag block U+E0000–U+E007F.
_TAG_RE = re.compile(r"[\U000E0000-\U000E007F]")
# Zero-width: ZWSP, ZWNJ, ZWJ, WJ, BOM/ZWNBSP.
_ZERO_WIDTH_RE = re.compile(r"[​-‍⁠﻿]")
# Bidirectional overrides.
_BIDI_RE = re.compile(r"[‪-‮⁦-⁩]")
# C0 (excluding tab/lf/cr) + C1 controls.
_CTRL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]")


def _escape_path_token(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _sanitize_string(s: str, path: str) -> tuple[str, list[dict]]:
    findings: list[dict] = []

    def strip(pattern: re.Pattern[str], kind: str, text: str) -> str:
        count = sum(len(m.group(0)) for m in pattern.finditer(text))
        if count:
            findings.append({"path": path, "kind": kind, "count": count})
            return pattern.sub("", text)
        return text

    out = strip(_TAG_RE, "unicode-tags", s)
    out = strip(_ZERO_WIDTH_RE, "zero-width", out)
    out = strip(_BIDI_RE, "bidi-override", out)
    out = strip(_CTRL_RE, "control-char", out)
    nfkc = unicodedata.normalize("NFKC", out)
    if nfkc != out:
        findings.append({"path": path, "kind": "nfkc-normalized", "count": 1})
        out = nfkc
    return out, findings


def _sanitize_value(value: Any, path: str) -> tuple[Any, list[dict]]:
    if isinstance(value, str):
        return _sanitize_string(value, path)
    if isinstance(value, list):
        out: list[Any] = []
        findings: list[dict] = []
        for i, item in enumerate(value):
            v, f = _sanitize_value(item, f"{path}/{i}")
            out.append(v)
            findings.extend(f)
        return out, findings
    if isinstance(value, dict):
        out_d: dict[str, Any] = {}
        findings = []
        for k, v in value.items():
            nv, f = _sanitize_value(v, f"{path}/{_escape_path_token(str(k))}")
            out_d[k] = nv
            findings.extend(f)
        return out_d, findings
    return value, []


def sanitize(value: Any) -> dict:
    """Returns `{value, report: {modified, findings}}`.

    `findings` is sorted by (path, kind) so the resulting report is
    deterministic and matches the TypeScript implementation.
    """
    out, findings = _sanitize_value(value, "")
    findings.sort(key=lambda f: (f["path"], f["kind"]))
    return {
        "value": out,
        "report": {"modified": len(findings) > 0, "findings": findings},
    }
