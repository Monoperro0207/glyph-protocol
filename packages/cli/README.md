# @glyphp/cli

The command-line tool for the [Glyph Protocol](../../spec/protocol.md).

```bash
npm install -g @glyphp/cli
```

## Commands

### `glyph inspect <url> [glyph]`

Connect to a Glyph server and show its lexicon. Pass a glyph name to print
that card in full, including whether its signature verifies.

```bash
glyph inspect http://localhost:3100
glyph inspect http://localhost:3100 greet
```

### `glyph verify <file|url>`

Verify a glyph card's content hash and ed25519 signature. Accepts a local
JSON file or an `http(s)` URL. Exits `0` if the card is valid, `1` otherwise.

```bash
glyph verify ./card.json
glyph verify http://localhost:3100/glyphs/greet
```

### `glyph init [dir]`

Scaffold a new Glyph server project — a minimal `server.ts` with one example
glyph, plus `package.json`, `tsconfig.json`, and `.gitignore`.

```bash
glyph init my-server
```
