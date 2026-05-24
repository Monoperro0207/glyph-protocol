# glyph-protocol — Python SDK

Verify Glyph Protocol cards, receipts and key registries from Python, and
call Glyph servers from agent code outside the Node.js ecosystem.

## Install

```bash
pip install glyph-protocol
```

## Verify a card

```python
from glyph_protocol import verify_glyph

card = httpx.get("https://example.com/glyphs/refund-payment").json()
assert verify_glyph(card)
```

## Call a glyph

```python
from glyph_protocol import Client, verify_receipt

client = Client("https://example.com")
envelope = client.call("greet", {"name": "World"})
assert verify_receipt(envelope["receipt"])
```

## Compatibility

This SDK targets **Glyph Protocol 1.0** and is tested against the canonical
test vectors under `spec/canonical/` in the main repo — so a value canonicalized
or signed in Python verifies bit-identical to its TypeScript and Go counterparts.

See `spec/protocol.md` and `spec/rfcs/RFC-0001-key-registry.md` for the
normative protocol.
