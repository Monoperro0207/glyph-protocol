import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'

export type InitProfile =
  | 'local-dev'
  | 'production-server'
  | 'agent-ts'
  | 'mcp-bridge'
  | 'openapi-wrapper'
  | 'python-client'
  // Legacy alias for agent-ts kept so older invocations keep working.
  | 'consumer-agent'

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
    },
  },
  null,
  2,
)}\n`

// ---- local-dev (the original scaffold, kept as default) -------------------

const LOCAL_DEV_SERVER = `import { GlyphServer, defineGlyph } from '@glyphp/server'
import { z } from 'zod'

const greet = defineGlyph({
  name: 'greet',
  intent: 'Returns a friendly greeting for the given name',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  provider: 'my-glyph-server',
  handler: async ({ name }) => ({ greeting: \`Hello, \${name}!\` }),
})

const server = new GlyphServer({ port: 3100 })
server.register(greet)
await server.start()
`

// ---- production-server (stable key + auth + rate limit + key registry) ----

const PRODUCTION_SERVER = `import { GlyphServer, defineGlyph } from '@glyphp/server'
import {
  buildKeyEntry,
  buildKeyRegistry,
  generateKeyPair,
  StaticKeyRegistry,
} from '@glyphp/core'
import { z } from 'zod'

// Load the stable keypair from secrets at boot — never generate at runtime.
const keyPair = {
  publicKey: process.env.GLYPH_PUBLIC_KEY!,
  privateKey: process.env.GLYPH_PRIVATE_KEY!,
}
if (!keyPair.publicKey || !keyPair.privateKey) {
  throw new Error(
    'GLYPH_PUBLIC_KEY and GLYPH_PRIVATE_KEY are required (load from your secret manager).'
  )
}
const authToken = process.env.GLYPH_AUTH_TOKEN
if (!authToken) throw new Error('GLYPH_AUTH_TOKEN is required.')

// Build a registry from the active key — rotate via \`glyph keys rotate\`.
const genesis = buildKeyEntry(keyPair.publicKey, new Date().toISOString())
const registry = buildKeyRegistry({
  serverId: process.env.GLYPH_SERVER_ID ?? 'my-server',
  entries: [genesis],
  activePrivateKey: keyPair.privateKey,
})

const echo = defineGlyph({
  name: 'echo',
  intent: 'Echoes its input — replace with your real tools',
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  input: z.object({ value: z.string() }),
  output: z.object({ value: z.string() }),
  provider: 'my-glyph-server',
  handler: async (input) => input,
})

const server = new GlyphServer({
  port: 3100,
  keyPair,
  auth: { tokens: [authToken] },
  rateLimit: { windowMs: 60_000, max: 200 },
  keyRegistry: new StaticKeyRegistry(registry),
  strictProduction: true,
  // Persist every call's signed receipt to your audit log here:
  onCall: (receipt) => console.log(JSON.stringify(receipt)),
})
server.register(echo)
await server.start()
`

// ---- consumer-agent (client + secure pin store + render layer) ------------

const CONSUMER_AGENT = `import { GlyphClient, FilePinStore, renderEnvelope, dataPreamble } from '@glyphp/client'
import { verifyReceipt } from '@glyphp/core'

const baseUrl = process.env.GLYPH_SERVER_URL ?? 'http://localhost:3100'
const authToken = process.env.GLYPH_AUTH_TOKEN
const pinsPath = process.env.GLYPH_PINS_PATH ?? \`\${process.env.HOME}/.glyph/pins.json\`

const client = new GlyphClient({
  baseUrl,
  authToken,
  pins: new FilePinStore(pinsPath),
  secureMode: true, // refuses to construct without a PinStore
})

await client.connect()
const lexicon = await client.getLexicon()
console.log('Available glyphs:')
for (const entry of lexicon) console.log(\`  - \${entry.name}: \${entry.intent}\`)

// Emit the data preamble ONCE, as a trusted system message to the model:
console.log('\\nSystem preamble:\\n' + dataPreamble().content)

// Replace with a real glyph from your server:
if (lexicon.length > 0) {
  const tool = lexicon[0]
  const card = await client.getCard(tool.name)
  console.log(\`\\nFirst tool: \${tool.name} — review and approve via\\n  glyph approve <card.json>\`)
  // const envelope = await client.call(tool.name, { /* input */ })
  // console.log(renderEnvelope(envelope, { verify: (e) => verifyReceipt(e.receipt!) }))
}
`

// ---- mcp-bridge (Glyph server that re-exports an MCP server) -------------

const MCP_BRIDGE_SERVER = `import { GlyphServer } from '@glyphp/server'
import { connectMcpServer, mcpToolToGlyph } from '@glyphp/adapter-mcp'

// Point this at any MCP server (filesystem, github, custom, …). The bridge
// pulls the MCP tool list, signs each as a Glyph card and re-exports them.
const mcp = await connectMcpServer({
  command: process.env.MCP_COMMAND ?? 'npx',
  args: (process.env.MCP_ARGS ?? '@modelcontextprotocol/server-filesystem ./workspace').split(' '),
})

const server = new GlyphServer({ port: Number(process.env.PORT ?? 3100) })
for (const tool of await mcp.listTools()) {
  server.register(mcpToolToGlyph(tool, mcp))
}
console.log(\`[mcp-bridge] re-exporting \${server.glyphs?.size ?? '?'} MCP tools\`)
await server.start()
`

// ---- openapi-wrapper (Glyph server that re-exports an OpenAPI 3.x spec) --

const OPENAPI_WRAPPER_SERVER = `import { GlyphServer } from '@glyphp/server'
import { openapiToGlyphs } from '@glyphp/adapter-openapi'
import { readFile } from 'node:fs/promises'

// Drop your OpenAPI 3.x spec at ./openapi.json (or set OPENAPI_PATH).
const spec = JSON.parse(
  await readFile(process.env.OPENAPI_PATH ?? './openapi.json', 'utf8')
)
const server = new GlyphServer({ port: Number(process.env.PORT ?? 3100) })
for (const glyph of openapiToGlyphs(spec, { baseUrl: process.env.UPSTREAM_BASE_URL })) {
  server.register(glyph)
}
console.log('[openapi-wrapper] exposing OpenAPI operations as glyphs')
await server.start()
`

// ---- python-client (PyPI glyph-protocol client) ---------------------------

const PYTHON_CLIENT = `import os
from glyph_protocol import GlyphClient, verify_card

base_url = os.environ.get("GLYPH_SERVER_URL", "http://localhost:3100")
auth_token = os.environ.get("GLYPH_AUTH_TOKEN")

client = GlyphClient(base_url, auth_token=auth_token)
client.connect()

for entry in client.get_lexicon():
    print(f"- {entry['name']}: {entry['intent']}")

# Approve a card before calling it:
# card = client.get_card("my-tool")
# verify_card(card)
# result = client.call("my-tool", {"...": "..."})
# print(result)
`

const PYTHON_REQUIREMENTS = `glyph-protocol>=1.0.0,<2.0.0
`

const PROFILES: Record<
  InitProfile,
  {
    entry: string
    entryFile: string
    pkg: Record<string, unknown>
    extras?: Record<string, string>
  }
> = {
  'local-dev': {
    entry: LOCAL_DEV_SERVER,
    entryFile: 'server.ts',
    pkg: {
      name: 'my-glyph-server',
      private: true,
      type: 'module',
      scripts: { dev: 'tsx server.ts' },
      dependencies: { '@glyphp/server': 'latest', zod: '^3.23.8' },
      devDependencies: { tsx: '^4.11.0' },
    },
  },
  'production-server': {
    entry: PRODUCTION_SERVER,
    entryFile: 'server.ts',
    pkg: {
      name: 'my-glyph-server',
      private: true,
      type: 'module',
      scripts: { start: 'tsx server.ts' },
      dependencies: {
        '@glyphp/server': 'latest',
        '@glyphp/core': 'latest',
        zod: '^3.23.8',
      },
      devDependencies: { tsx: '^4.11.0' },
    },
  },
  'agent-ts': {
    entry: CONSUMER_AGENT,
    entryFile: 'agent.ts',
    pkg: {
      name: 'my-glyph-agent',
      private: true,
      type: 'module',
      scripts: { start: 'tsx agent.ts' },
      dependencies: {
        '@glyphp/client': 'latest',
        '@glyphp/core': 'latest',
      },
      devDependencies: { tsx: '^4.11.0' },
    },
  },
  // Legacy alias — kept so older invocations keep working.
  'consumer-agent': {
    entry: CONSUMER_AGENT,
    entryFile: 'agent.ts',
    pkg: {
      name: 'my-glyph-agent',
      private: true,
      type: 'module',
      scripts: { start: 'tsx agent.ts' },
      dependencies: {
        '@glyphp/client': 'latest',
        '@glyphp/core': 'latest',
      },
      devDependencies: { tsx: '^4.11.0' },
    },
  },
  'mcp-bridge': {
    entry: MCP_BRIDGE_SERVER,
    entryFile: 'server.ts',
    pkg: {
      name: 'my-mcp-bridge',
      private: true,
      type: 'module',
      scripts: { start: 'tsx server.ts' },
      dependencies: {
        '@glyphp/server': 'latest',
        '@glyphp/adapter-mcp': 'latest',
      },
      devDependencies: { tsx: '^4.11.0' },
    },
  },
  'openapi-wrapper': {
    entry: OPENAPI_WRAPPER_SERVER,
    entryFile: 'server.ts',
    pkg: {
      name: 'my-openapi-wrapper',
      private: true,
      type: 'module',
      scripts: { start: 'tsx server.ts' },
      dependencies: {
        '@glyphp/server': 'latest',
        '@glyphp/adapter-openapi': 'latest',
      },
      devDependencies: { tsx: '^4.11.0' },
    },
  },
  'python-client': {
    entry: PYTHON_CLIENT,
    entryFile: 'agent.py',
    pkg: {
      name: 'my-glyph-python-client',
      private: true,
      type: 'module',
    },
    extras: { 'requirements.txt': PYTHON_REQUIREMENTS },
  },
}

/** Scaffolds a Glyph project into `dir` using the chosen profile. */
export async function runInit(
  dir: string,
  options: { profile?: InitProfile } = {},
): Promise<string> {
  // Production-server is the default since v1.0 so a fresh scaffold uses
  // stable keys, auth, rate limiting and a pin store out of the box. Pass
  // `--profile local-dev` to opt into the ephemeral-key prototype scaffold.
  const profile = options.profile ?? 'production-server'
  const cfg = PROFILES[profile]
  if (!cfg) {
    throw new Error(
      `unknown profile "${profile}" — choose from: ${Object.keys(PROFILES).join(', ')}`,
    )
  }

  await mkdir(dir, { recursive: true })
  const existing = await readdir(dir)
  if (existing.includes('package.json') || existing.includes(cfg.entryFile)) {
    throw new Error(`${dir} already contains a project — refusing to overwrite`)
  }

  await writeFile(join(dir, 'package.json'), `${JSON.stringify(cfg.pkg, null, 2)}\n`)
  await writeFile(join(dir, cfg.entryFile), cfg.entry)
  if (profile !== 'python-client') {
    await writeFile(join(dir, 'tsconfig.json'), TSCONFIG)
  }
  await writeFile(
    join(dir, '.gitignore'),
    profile === 'python-client' ? 'venv\n__pycache__\n*.pyc\n' : 'node_modules\n',
  )
  if (cfg.extras) {
    for (const [name, body] of Object.entries(cfg.extras)) {
      await writeFile(join(dir, name), body)
    }
  }

  const nextSteps =
    profile === 'production-server'
      ? [
          `  cd ${dir}`,
          '  pnpm install',
          '  # Set GLYPH_PUBLIC_KEY, GLYPH_PRIVATE_KEY, GLYPH_AUTH_TOKEN in your env',
          '  pnpm start',
        ]
      : profile === 'agent-ts' || profile === 'consumer-agent'
        ? [
            `  cd ${dir}`,
            '  pnpm install',
            '  # Set GLYPH_SERVER_URL (and optionally GLYPH_AUTH_TOKEN)',
            '  pnpm start',
          ]
        : profile === 'mcp-bridge'
          ? [
              `  cd ${dir}`,
              '  pnpm install',
              '  # Point MCP_COMMAND/MCP_ARGS at the MCP server you want to re-export',
              '  pnpm start',
            ]
          : profile === 'openapi-wrapper'
            ? [
                `  cd ${dir}`,
                '  pnpm install',
                '  # Drop your OpenAPI 3.x spec at ./openapi.json and set UPSTREAM_BASE_URL',
                '  pnpm start',
              ]
            : profile === 'python-client'
              ? [
                  `  cd ${dir}`,
                  '  python -m venv venv && source venv/bin/activate',
                  '  pip install -r requirements.txt',
                  '  # Set GLYPH_SERVER_URL (and optionally GLYPH_AUTH_TOKEN)',
                  '  python agent.py',
                ]
              : [`  cd ${dir}`, '  pnpm install', '  pnpm dev']

  return [
    `Scaffolded a Glyph project (profile: ${profile}) in ${dir}`,
    `  package.json  ·  ${cfg.entryFile}  ·  tsconfig.json  ·  .gitignore`,
    '',
    'next steps:',
    ...nextSteps,
  ].join('\n')
}

/** Profiles offered in the interactive picker, in display order. */
const PROMPT_CHOICES: Array<{ key: string; profile: InitProfile; label: string }> = [
  {
    key: '1',
    profile: 'production-server',
    label: 'production-server  (recommended — stable key, auth, rate limit, pin store)',
  },
  {
    key: '2',
    profile: 'agent-ts',
    label: 'agent-ts             (TypeScript consumer with pin store)',
  },
  {
    key: '3',
    profile: 'mcp-bridge',
    label: 'mcp-bridge           (re-export an MCP server as glyphs)',
  },
  {
    key: '4',
    profile: 'openapi-wrapper',
    label: 'openapi-wrapper      (re-export an OpenAPI 3.x spec as glyphs)',
  },
  {
    key: '5',
    profile: 'python-client',
    label: 'python-client        (Python script using glyph-protocol on PyPI)',
  },
  {
    key: '6',
    profile: 'local-dev',
    label: 'local-dev            (ephemeral key, no auth — prototyping only)',
  },
]

/**
 * Interactive profile picker — only used by the CLI when stdin is a TTY
 * and no `--profile` flag was given. Press Enter to accept the
 * recommended default (`production-server`).
 */
export async function promptInitProfile(): Promise<InitProfile> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    stdout.write('\nChoose a starting profile:\n')
    for (const c of PROMPT_CHOICES) {
      stdout.write(`  ${c.key}) ${c.label}\n`)
    }
    const answer = (await rl.question('> [1] ')).trim() || '1'
    const match = PROMPT_CHOICES.find((c) => c.key === answer || c.profile === answer)
    if (!match) {
      stdout.write(`Unknown choice "${answer}" — falling back to production-server.\n`)
      return 'production-server'
    }
    return match.profile
  } finally {
    rl.close()
  }
}
