import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SERVER_TS = `import { GlyphServer, defineGlyph } from '@glyphp/server'
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

const PACKAGE_JSON =
  JSON.stringify(
    {
      name: 'my-glyph-server',
      private: true,
      type: 'module',
      scripts: { dev: 'tsx server.ts' },
      dependencies: {
        // `latest` so a freshly scaffolded project always installs the
        // current release rather than a version that goes stale here.
        '@glyphp/server': 'latest',
        zod: '^3.23.8',
      },
      devDependencies: { tsx: '^4.11.0' },
    },
    null,
    2
  ) + '\n'

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

/** Scaffolds a minimal Glyph server project into `dir`. */
export async function runInit(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const existing = await readdir(dir)
  if (existing.includes('package.json') || existing.includes('server.ts')) {
    throw new Error(`${dir} already contains a project — refusing to overwrite`)
  }

  await writeFile(join(dir, 'package.json'), PACKAGE_JSON)
  await writeFile(join(dir, 'server.ts'), SERVER_TS)
  await writeFile(join(dir, 'tsconfig.json'), TSCONFIG)
  await writeFile(join(dir, '.gitignore'), 'node_modules\n')

  return [
    `Scaffolded a Glyph project in ${dir}`,
    '  package.json  ·  server.ts  ·  tsconfig.json  ·  .gitignore',
    '',
    'next steps:',
    `  cd ${dir}`,
    '  pnpm install',
    '  pnpm dev',
  ].join('\n')
}
