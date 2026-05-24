"""PinStore — persistent record of approved tool cards."""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional


@dataclass
class Pin:
    tool_name: str
    approved_at: str
    card: dict
    revoked_at: Optional[str] = None
    revoke_reason: Optional[str] = None

    def to_dict(self) -> dict:
        d = {
            "toolName": self.tool_name,
            "approvedAt": self.approved_at,
            "card": self.card,
        }
        if self.revoked_at:
            d["revokedAt"] = self.revoked_at
        if self.revoke_reason:
            d["revokeReason"] = self.revoke_reason
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Pin":
        return cls(
            tool_name=d["toolName"],
            approved_at=d["approvedAt"],
            card=d["card"],
            revoked_at=d.get("revokedAt"),
            revoke_reason=d.get("revokeReason"),
        )


class MemoryPinStore:
    """In-memory pin store. Convenient for tests; lost on process restart."""

    def __init__(self) -> None:
        self._pins: dict[str, Pin] = {}

    def get(self, tool_name: str) -> Optional[Pin]:
        return self._pins.get(tool_name)

    def put(self, pin: Pin) -> None:
        self._pins[pin.tool_name] = pin

    def all(self) -> list[Pin]:
        return list(self._pins.values())


class FilePinStore:
    """JSON-on-disk pin store with atomic writes (write-to-temp + rename)."""

    def __init__(self, path: str) -> None:
        self.path = path

    def _load(self) -> dict[str, Pin]:
        if not os.path.exists(self.path):
            return {}
        with open(self.path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {p["toolName"]: Pin.from_dict(p) for p in data.get("pins", [])}

    def get(self, tool_name: str) -> Optional[Pin]:
        return self._load().get(tool_name)

    def all(self) -> list[Pin]:
        return list(self._load().values())

    def put(self, pin: Pin) -> None:
        pins = self._load()
        pins[pin.tool_name] = pin
        payload = {"version": 1, "pins": [p.to_dict() for p in pins.values()]}
        dirname = os.path.dirname(self.path) or "."
        fd, tmp = tempfile.mkstemp(dir=dirname, prefix=".pins-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
                f.write("\n")
            os.replace(tmp, self.path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat()
