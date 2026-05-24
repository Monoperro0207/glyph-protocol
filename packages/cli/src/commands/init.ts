import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type InitProfile =
  | 'local-dev'
  | 'production-server'
  | 'consumer-agent'

const TSCONFIG =
  JSON.stringify(
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
    2
  ) + '\n'

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

const PROFILES: Record<
  InitProfile,
  { entry: string; entryFile: string; pkg: Record<string, unknown> }
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
}

/** Scaffolds a Glyph project into `dir` using the chosen profile. */
export async function runInit(
  dir: string,
  options: { profile?: InitProfile } = {}
): Promise<string> {
  const profile = options.profile ?? 'local-dev'
  const cfg = PROFILES[profile]
  if (!cfg) {
    throw new Error(
      `unknown profile "${profile}" — choose from: ${Object.keys(PROFILES).join(', ')}`
    )
  }

  await mkdir(dir, { recursive: true })
  const existing = await readdir(dir)
  if (existing.includes('package.json') || existing.includes(cfg.entryFile)) {
    throw new Error(`${dir} already contains a project — refusing to overwrite`)
  }

  await writeFile(join(dir, 'package.json'), JSON.stringify(cfg.pkg, null, 2) + '\n')
  await writeFile(join(dir, cfg.entryFile), cfg.entry)
  await writeFile(join(dir, 'tsconfig.json'), TSCONFIG)
  await writeFile(join(dir, '.gitignore'), 'node_modules\n')

  const nextSteps =
    profile === 'production-server'
      ? [
          '  cd ' + dir,
          '  pnpm install',
          '  # Set GLYPH_PUBLIC_KEY, GLYPH_PRIVATE_KEY, GLYPH_AUTH_TOKEN in your env',
          '  pnpm start',
        ]
      : profile === 'consumer-agent'
        ? [
            '  cd ' + dir,
            '  pnpm install',
            '  # Set GLYPH_SERVER_URL (and optionally GLYPH_AUTH_TOKEN)',
            '  pnpm start',
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
