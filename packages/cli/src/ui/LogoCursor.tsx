import { Text } from 'ink'
import { type JSX, useEffect, useState } from 'react'

// A pulsing glyph mark — the animated cursor that gives the shell its identity.
// Evokes the signed-glyph diamond from the logo (assets/glyphp.png) cycling
// through draw/seal/verify frames.
const FRAMES = ['⟡', '◈', '◆', '◈']

export interface LogoCursorProps {
  /** Frame interval in ms. */
  intervalMs?: number
  color?: string
}

export function LogoCursor({ intervalMs = 180, color = 'cyan' }: LogoCursorProps): JSX.Element {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return (
    <Text color={color} bold>
      {FRAMES[frame]}
    </Text>
  )
}
