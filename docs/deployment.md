# Deploying a Glyph Server

This is an operational guide. For the security model, see
[`spec/security.md`](../spec/security.md).

## Checklist

Before exposing a Glyph server beyond local development:

- [ ] Pass a **stable `keyPair`** — never generate ephemeral at startup.
      Store the private key in a secret manager and load at boot.
- [ ] Run behind **TLS**. Never serve the protocol in clear text.
- [ ] Enable **`auth`** with a non-trivial bearer token, and rotate it.
- [ ] Configure **`rateLimit`** for both per-token and edge limits.
- [ ] Set `cost.requiresConfirmation: true` on every irreversible or
      high-risk glyph and have handlers honour the `AbortSignal`.
- [ ] Persist receipts via the **`onCall`** hook to a tamper-evident
      audit log (file, SIEM, or append-only DB).
- [ ] Publish a **`KeyRegistry`** via `serverOptions.keyRegistry` so
      clients can verify your active key and pick up rotations or
      revocations ([RFC-0001](../spec/rfcs/RFC-0001-key-registry.md)).
- [ ] Run **`glyph-conformance`** against the deployed URL; commit the
      report so consumers can verify compatibility.

## Docker

A minimal Dockerfile:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY . .
CMD ["node", "dist/server.js"]
```

A typical `docker-compose.yml` puts the Glyph server behind a TLS
reverse-proxy (Caddy / Traefik / nginx):

```yaml
services:
  glyph:
    image: my-glyph-server:latest
    environment:
      GLYPH_PRIVATE_KEY: /run/secrets/glyph_privkey
      GLYPH_AUTH_TOKEN: /run/secrets/glyph_token
    secrets: [glyph_privkey, glyph_token]
  edge:
    image: caddy:2
    ports: ["443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
```

The sample under [`examples/05-hermes-integration`](../examples/05-hermes-integration/)
is a complete reference, including DeepSeek-V4 Flash agent loop and a
Python cross-language test.

## Secrets

Store the ed25519 private key in your platform's secret manager
(AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault / Doppler).
At boot:

```ts
import { GlyphServer } from '@glyphp/server'

const keyPair = {
  publicKey: process.env.GLYPH_PUBLIC_KEY!,
  privateKey: await fetchSecret('glyph_private_key'),
}
const server = new GlyphServer({ keyPair, /* ... */ })
```

Rotate via `glyph keys rotate` (see `glyph --help`). Update the secret
manager with the new private key; the old key remains valid until its
`validUntil` window expires.

## Running more than one replica

Two pieces of server state are process-local by default, and both change
behavior behind a load balancer:

- **Confirmation tickets.** A `confirmationToken` issued by replica A fails on
  replica B with `INVALID_CONFIRMATION`.
- **Rate-limit counters.** Each replica counts independently, so the effective
  limit is `N × max`.

Both stores are injectable. Implement `ConfirmationStore` and `RateLimitStore`
(exported by `@glyphp/server`) over shared storage and pass them in:

```ts
import { createClient } from 'redis'
import type { ConfirmationStore, PendingConfirmation, RateLimitStore } from '@glyphp/server'
import { GlyphServer } from '@glyphp/server'

const redis = createClient({ url: process.env.REDIS_URL })

const confirmations: ConfirmationStore = {
  async put(token, entry) {
    await redis.set(`confirm:${token}`, JSON.stringify(entry), {
      PX: entry.expiresAt - Date.now(),
    })
  },
  async consume(token) {
    // GETDEL is atomic: two replicas racing on the same token cannot both win.
    const raw = await redis.getDel(`confirm:${token}`)
    return raw ? (JSON.parse(raw) as PendingConfirmation) : undefined
  },
  async sweep() {
    // Redis evicts by TTL on its own; report an approximate backlog.
    const size = await redis.eval(
      "return #redis.call('KEYS', 'confirm:*')", { keys: [], arguments: [] },
    )
    return { size: Number(size) }
  },
}

const rateLimit: RateLimitStore = {
  async hit(key, windowMs, now) {
    const bucket = `rl:${key}:${Math.floor(now / windowMs)}`
    const count = await redis.incr(bucket)
    if (count === 1) await redis.pExpire(bucket, windowMs)
    return { count, resetAt: (Math.floor(now / windowMs) + 1) * windowMs }
  },
}

const server = new GlyphServer({
  confirmationStore: confirmations,
  rateLimitStore: rateLimit,
  /* ... */
})
```

Cards, manifests and the key registry are immutable or registered at boot on
every replica, so they need no shared store. Receipts are signed per replica
by the same key.

## Observability

- Receipts are the audit trail — pipe them to a SIEM via `onCall`.
- The conformance JSON report should run on a schedule against
  production and on every release.
- Track `HANDLER_TIMEOUT` and `RATE_LIMITED` rates — they are usually
  the first signal that something upstream is unhealthy.

## Going wrong

If you see `OUTPUT_VALIDATION_FAILED` from an adapter, an upstream tool
changed its response shape. Update the adapter's source schema or fall
back to `outputValidation: 'none'` (and accept the trust tradeoff).

If clients start failing verification after a key rotation, they are
caching an old `KeyRegistry`. Lower `ttlSeconds` or push a new one.
