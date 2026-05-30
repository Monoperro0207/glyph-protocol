import { Box, Text, useApp, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { runKeysList } from '../commands/keys.js'
import { runPinsList } from '../commands/pins.js'
import { LogoCursor } from './LogoCursor.js'

const DEFAULT_KEYS_FILE = 'keys.json'

type View = 'menu' | 'pins' | 'keys' | 'help'

interface MenuItem {
  key: View | 'quit'
  label: string
  hint: string
}

const MENU: MenuItem[] = [
  { key: 'pins', label: 'Pins', hint: 'approved tools and their status' },
  { key: 'keys', label: 'Keys', hint: 'local key registry' },
  { key: 'help', label: 'Help', hint: 'commands and shortcuts' },
  { key: 'quit', label: 'Quit', hint: 'exit glyphp' },
]

/** A read-only panel that runs an async loader and renders its text report. */
function ReportView({ title, load }: { title: string; load: () => Promise<string> }): JSX.Element {
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; text: string }>({
    status: 'loading',
    text: '',
  })
  useEffect(() => {
    let alive = true
    load()
      .then((text) => alive && setState({ status: 'ok', text }))
      .catch((e) => alive && setState({ status: 'error', text: String(e?.message ?? e) }))
    return () => {
      alive = false
    }
  }, [load])

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {state.status === 'loading' && <Text dimColor>loading…</Text>}
        {state.status === 'error' && <Text color="red">{state.text}</Text>}
        {state.status === 'ok' && <Text>{state.text}</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>esc / q — back to menu</Text>
      </Box>
    </Box>
  )
}

export function App(): JSX.Element {
  const { exit } = useApp()
  const [view, setView] = useState<View>('menu')
  const [cursor, setCursor] = useState(0)

  useInput((input, key) => {
    if (view === 'menu') {
      if (key.upArrow || input === 'k') setCursor((c) => (c - 1 + MENU.length) % MENU.length)
      else if (key.downArrow || input === 'j') setCursor((c) => (c + 1) % MENU.length)
      else if (key.return) {
        const item = MENU[cursor]
        if (item.key === 'quit') exit()
        else setView(item.key)
      } else if (input === 'q') exit()
    } else if (key.escape || input === 'q') {
      setView('menu')
    }
  })

  if (view === 'pins') {
    return <ReportView title="Pins" load={() => runPinsList().then((r) => r.report)} />
  }
  if (view === 'keys') {
    return (
      <ReportView
        title={`Key registry — ${DEFAULT_KEYS_FILE}`}
        load={() => runKeysList({ file: DEFAULT_KEYS_FILE }).then((r) => r.report)}
      />
    )
  }
  if (view === 'help') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">
          glyphp — interactive shell
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Navigate with ↑/↓ (or j/k), Enter to open, esc/q to go back.</Text>
          <Text>{'For scripting and CI use the one-shot CLI: `glyph <command>`.'}</Text>
          <Text dimColor>inspect · verify · diff-card · pins · approve · keys · import mcp</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>esc / q — back to menu</Text>
        </Box>
      </Box>
    )
  }

  // Home menu.
  return (
    <Box flexDirection="column">
      <Box>
        <LogoCursor />
        <Text bold> Glyph Protocol</Text>
        <Text dimColor> · interactive shell</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {MENU.map((item, i) => {
          const selected = i === cursor
          return (
            <Text key={item.key} color={selected ? 'cyan' : undefined}>
              {selected ? '❯ ' : '  '}
              <Text bold={selected}>{item.label.padEnd(8)}</Text>
              <Text dimColor>{item.hint}</Text>
            </Text>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · enter select · q quit</Text>
      </Box>
    </Box>
  )
}
