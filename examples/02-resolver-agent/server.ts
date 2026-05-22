import { defineGlyph, GlyphServer } from '@glyph-protocol/server'
import { z } from 'zod'

const searchFlights = defineGlyph({
  name: 'search-flights',
  intent: 'Search for available flights between two cities on a given date',
  tags: ['travel', 'flights', 'search'],
  cost: {
    latency: 'medium',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  idempotent: true,
  input: z.object({ from: z.string(), to: z.string(), date: z.string() }),
  output: z.object({
    flights: z.array(z.object({ id: z.string(), price: z.number() })),
  }),
  provider: 'travel-demo',
  handler: async ({ from, to }) => ({
    flights: [
      { id: `${from}-${to}-A1`, price: 780 },
      { id: `${from}-${to}-B2`, price: 910 },
    ],
  }),
})

const bookFlight = defineGlyph({
  name: 'book-flight',
  intent: 'Book a specific flight and charge the traveler payment method',
  tags: ['travel', 'flights', 'booking'],
  cost: {
    latency: 'slow',
    sideEffects: true,
    reversible: false,
    riskTier: 'danger',
    requiresConfirmation: true,
  },
  idempotent: false,
  input: z.object({ flightId: z.string() }),
  output: z.object({ bookingRef: z.string() }),
  provider: 'travel-demo',
  handler: async ({ flightId }) => ({ bookingRef: `BK-${flightId}` }),
})

const getWeather = defineGlyph({
  name: 'get-weather',
  intent: 'Get the current weather forecast for a city',
  tags: ['weather', 'forecast'],
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  idempotent: true,
  input: z.object({ city: z.string() }),
  output: z.object({ city: z.string(), tempC: z.number(), summary: z.string() }),
  provider: 'travel-demo',
  handler: async ({ city }) => ({ city, tempC: 21, summary: 'Clear skies' }),
})

const convertCurrency = defineGlyph({
  name: 'convert-currency',
  intent: 'Convert an amount of money between two currencies',
  tags: ['currency', 'money', 'finance'],
  cost: {
    latency: 'fast',
    sideEffects: false,
    reversible: true,
    riskTier: 'safe',
    requiresConfirmation: false,
  },
  idempotent: true,
  input: z.object({ amount: z.number(), from: z.string(), to: z.string() }),
  output: z.object({ result: z.number() }),
  provider: 'travel-demo',
  handler: async ({ amount }) => ({ result: Math.round(amount * 1.08 * 100) / 100 }),
})

const cancelBooking = defineGlyph({
  name: 'cancel-booking',
  intent: 'Cancel an existing flight booking and issue a refund',
  tags: ['travel', 'booking', 'refund'],
  cost: {
    latency: 'medium',
    sideEffects: true,
    reversible: false,
    riskTier: 'caution',
    requiresConfirmation: true,
  },
  idempotent: true,
  input: z.object({ bookingRef: z.string() }),
  output: z.object({ refunded: z.boolean() }),
  provider: 'travel-demo',
  handler: async () => ({ refunded: true }),
})

const server = new GlyphServer({ port: 3100 })
for (const glyph of [
  searchFlights,
  bookFlight,
  getWeather,
  convertCurrency,
  cancelBooking,
]) {
  server.register(glyph)
}
await server.start()
