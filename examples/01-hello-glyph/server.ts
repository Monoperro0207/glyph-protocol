import { defineGlyph, GlyphServer } from '@glyphp/server'
import { z } from 'zod'

const greet = defineGlyph({
  name: 'greet',
  intent: 'Generates a personalized greeting for a given name',
  tags: ['demo', 'text'],
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  idempotent: true,
  input: z.object({
    name: z.string().describe('The name to greet'),
    language: z.enum(['en', 'es']).default('en').describe('Greeting language'),
  }),
  output: z.object({
    message: z.string(),
  }),
  examples: [
    {
      description: 'English greeting',
      input: { name: 'Alice', language: 'en' },
      output: { message: 'Hello, Alice!' },
    },
    {
      description: 'Spanish greeting',
      input: { name: 'Carlos', language: 'es' },
      output: { message: '¡Hola, Carlos!' },
    },
  ],
  failureModes: [{ code: 'EMPTY_NAME', description: 'Name cannot be an empty string' }],
  provider: 'hello-glyph-example',
  handler: async ({ name, language }) => {
    const message = language === 'es' ? `¡Hola, ${name}!` : `Hello, ${name}!`
    return { message }
  },
})

const server = new GlyphServer({ port: 3100 })
server.register(greet)
await server.start()
