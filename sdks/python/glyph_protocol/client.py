"""Glyph Protocol client — discover, fetch cards, prepare, call."""
from __future__ import annotations

from typing import Any, Optional

import httpx


PROTOCOL_VERSION = "1.0"


class Client:
    """HTTP client for a Glyph server. Mirrors `@glyphp/client.GlyphClient`."""

    def __init__(
        self,
        base_url: str,
        *,
        auth_token: Optional[str] = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        headers = {"content-type": "application/json"}
        if auth_token:
            headers["authorization"] = f"Bearer {auth_token}"
        self._http = httpx.Client(
            base_url=self.base_url,
            timeout=timeout_seconds,
            headers=headers,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ---- discovery --------------------------------------------------------

    def health(self) -> dict:
        return self._http.get("/health").json()

    def handshake(
        self,
        *,
        consumer_id: str = "glyph-python",
        context_budget: int = 50_000,
        preferred_card_depth: str = "standard",
    ) -> dict:
        body = {
            "protocolVersion": PROTOCOL_VERSION,
            "consumerId": consumer_id,
            "contextBudget": context_budget,
            "preferredCardDepth": preferred_card_depth,
        }
        res = self._http.post("/handshake", json=body)
        res.raise_for_status()
        return res.json()

    def lexicon(self) -> list[dict]:
        res = self._http.get("/lexicon")
        res.raise_for_status()
        return res.json()

    def get_card(self, name: str, *, depth: str = "rich") -> dict:
        res = self._http.get(f"/glyphs/{name}", params={"depth": depth})
        res.raise_for_status()
        return res.json()

    # ---- key registry -----------------------------------------------------

    def get_key_registry(self) -> Optional[dict]:
        """Returns the server's KeyRegistry (RFC-0001), or None if 404."""
        res = self._http.get("/keys")
        if res.status_code == 404:
            return None
        res.raise_for_status()
        return res.json()

    # ---- execution --------------------------------------------------------

    def prepare(self, name: str, input: dict) -> dict:
        res = self._http.post(f"/glyphs/{name}/prepare", json={"input": input})
        res.raise_for_status()
        return res.json()

    def call(
        self,
        name: str,
        input: dict,
        *,
        confirmation_token: Optional[str] = None,
        call_id: Optional[str] = None,
    ) -> dict:
        body: dict[str, Any] = {"input": input}
        if confirmation_token:
            body["confirmationToken"] = confirmation_token
        if call_id:
            body["callId"] = call_id
        res = self._http.post(f"/glyphs/{name}/call", json=body)
        res.raise_for_status()
        return res.json()
