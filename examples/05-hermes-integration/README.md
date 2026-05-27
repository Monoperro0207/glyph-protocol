# `05-hermes-integration` — Glyph ↔ MCP bridge ↔ DeepSeek-V4 Flash

End-to-end integration sandbox that proves a real LLM agent can consume Glyph tools through the MCP bridge. Two complementary tests in one image:

1. **Bridge test (`run-agent.py`)** — drives DeepSeek-V4 Flash against the Glyph→MCP bridge over the same MCP stdio transport an agent like [Hermes Agent](https://github.com/NousResearch/hermes-agent) uses. Counts tokens, writes a markdown report.
2. **Native protocol test (`native-test/test.py`)** — speaks Glyph's wire protocol directly from Python (no SDK), verifying signatures, canonical hashing, and receipt ed25519 verification across language boundaries.

The full audit report from the most recent canonical run is at [`spec/tests/hermes-deepseek.md`](../../spec/tests/hermes-deepseek.md).

## Run with Docker (recommended)

```bash
export DEEPSEEK_API_KEY=sk-...
docker compose run --rm sandbox all     # both tests
docker compose run --rm sandbox native  # cryptographic invariants only
docker compose run --rm sandbox hermes  # agent loop only
docker compose run --rm sandbox shell   # debug shell inside the container
```

Reports land in `results/` (mounted from the host).

## Run locally without Docker

If you don't want to install Docker, the same flow works from your host:

```bash
# Terminal 1 — Glyph server
pnpm install
pnpm --filter 05-hermes-integration server

# Terminal 2 — native test (no LLM, no API key needed)
python3 -m venv .venv && source .venv/bin/activate
pip install -r native-test/requirements.txt
GLYPH_SERVER_URL=http://127.0.0.1:3199 python native-test/test.py

# Terminal 2 — agent loop (consumes DeepSeek tokens)
export DEEPSEEK_API_KEY=sk-...
python scripts/run-agent.py
```

## What's in here

| File | What it does |
|---|---|
| `server.ts` | Glyph server with 8 tools: `fs.read/list/write`, `http.fetch`, `sql.query`, `math.sum/hash`, `util.uuid` |
| `bridge.ts` | Spawns `@glyphp/adapter-mcp-server` over stdio against the local Glyph server |
| `native-test/test.py` | Wire-protocol exerciser — verifies cards, signatures, receipts |
| `scripts/run-agent.py` | OpenAI-style chat-completions loop using DeepSeek + the bridge over MCP |
| `scripts/docker-entrypoint.sh` | Coordinates server boot and test execution inside the container |
| `seed.sql` | Sample data for `sql.query` (customers + orders) |
| `workspace/test-fixtures/` | Test files including one with invisible-Unicode prompt injection |
| `hermes-config/mcp.json` | Drop-in MCP server entry — point any MCP host (Claude Desktop, Cursor, Hermes) at this |
| `results/` | Per-run logs and markdown reports (gitignored) |

## Pointing real Hermes Agent at this

After `pnpm --filter 05-hermes-integration server` starts the Glyph server, the bridge is one MCP-server entry away from any MCP client. The shape in `hermes-config/mcp.json` is:

```json
{
  "mcpServers": {
    "glyph": {
      "command": "node",
      "args": ["bridge.js"],
      "cwd": "/abs/path/to/examples/05-hermes-integration",
      "env": { "GLYPH_SERVER_URL": "http://127.0.0.1:3199" }
    }
  }
}
```

For Hermes, copy that block into your Hermes MCP config (see [Hermes docs · MCP Integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)). Same shape works for Claude Desktop's `claude_desktop_config.json`, Cursor's MCP settings, and any other MCP-conformant host.

## Costs

A typical full run of the agent loop spends **~$0.003 USD** in DeepSeek tokens (~14k total). The native test costs nothing — no LLM involved.

## Security notes

- The Glyph server is bound to `127.0.0.1` only; nothing leaves the container by default.
- `http.fetch` whitelists `example.org` only.
- `fs.read/list/write` are jailed under `WORKSPACE_ROOT`.
- The DeepSeek API key is passed via env var; never committed.
