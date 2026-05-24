# 11 — Production deployment template

A minimal but realistic Glyph server deployment with everything the
production checklist asks for:

- Stable `keyPair` loaded from environment.
- Published `KeyRegistry` so clients can rotate / revoke (RFC-0001).
- Bearer-token auth on every endpoint except `/health`.
- Fixed-window rate limit.
- Persistent audit log via `onCall` — every signed receipt appended to
  `/app/audit/receipts.jsonl`.
- Docker image + docker-compose with a Caddy reverse-proxy terminating
  TLS.
- Conformance JSON badge committed to `report.json` after each deploy.

For the agent-loop integration story (DeepSeek + MCP bridge + Python
cross-language test) see [`examples/05-hermes-integration`](../05-hermes-integration/).

## Layout

```
server.ts             # the Glyph server with production hardening
Dockerfile            # builds the server image
docker-compose.yml    # server + Caddy edge with TLS
Caddyfile             # reverse-proxy config
.env.example          # required environment variables
report.json           # last conformance report (regenerate after deploy)
```

## Quickstart (local)

```bash
cp .env.example .env
# fill in GLYPH_PRIVATE_KEY (hex), GLYPH_PUBLIC_KEY (hex), GLYPH_AUTH_TOKEN

docker compose up --build

# In another shell, verify it:
pnpm exec glyph-conformance http://localhost:3100 \
  --level all \
  --fixture-echo conformance-echo \
  --fixture-requires-confirmation conformance-requires-confirmation \
  --fixture-slow conformance-slow \
  --fixture-invalid-output conformance-invalid-output \
  --auth-token "$GLYPH_AUTH_TOKEN" \
  --output report.json --markdown report.md
```

## Generating a keypair

The deployment requires a stable keypair. Generate one with the CLI:

```bash
pnpm exec glyph keys init --file ./keys.json --server-id my-server
# Reads keys.json → exports GLYPH_PUBLIC_KEY + GLYPH_PRIVATE_KEY
```

In production, store `GLYPH_PRIVATE_KEY` in your platform's secret
manager (AWS Secrets Manager, GCP Secret Manager, Vault, Doppler) and
load at boot — never bake it into the image.

## Rotation

```bash
pnpm exec glyph keys rotate \
  --file ./keys.json \
  --previous-private-key "$OLD_PRIVATE_KEY"
```

The new private key becomes the active signer; cards signed by the old
key continue to verify until its `validUntil` window expires.

## Why this layout

Everything here maps to a line in
[`docs/deployment.md`](../../docs/deployment.md). Treat that doc as the
spec and this example as a worked solution — both are kept in sync.
