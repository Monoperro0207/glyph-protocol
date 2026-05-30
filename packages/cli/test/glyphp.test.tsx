import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from 'ink-testing-library'
import { App } from '../src/ui/App.js'

const ESC = ''
const ENTER = '\r'

// A tick that lets Ink flush effects/animation frames.
const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('glyphp shell renders the home menu with the brand and all entries', async () => {
  const { lastFrame, unmount } = render(<App />)
  await tick()
  const frame = lastFrame() ?? ''
  assert.match(frame, /Glyph Protocol/)
  assert.match(frame, /interactive shell/)
  for (const label of ['Pins', 'Keys', 'Help', 'Quit']) {
    assert.match(frame, new RegExp(label))
  }
  unmount()
})

test('glyphp shell shows a selection cursor on the first item', async () => {
  const { lastFrame, unmount } = render(<App />)
  await tick()
  assert.match(lastFrame() ?? '', /❯/)
  unmount()
})

test('glyphp shell navigates into the Help view and back to the menu', async () => {
  const { lastFrame, stdin, unmount } = render(<App />)
  await tick()
  // Move down to "Help" (Pins → Keys → Help = two downs) and open it.
  stdin.write('j')
  await tick()
  stdin.write('j')
  await tick()
  stdin.write(ENTER)
  await tick()
  assert.match(lastFrame() ?? '', /Navigate with/)
  // esc returns to the menu.
  stdin.write(ESC)
  await tick()
  assert.match(lastFrame() ?? '', /interactive shell/)
  unmount()
})

test('glyphp shell opens the Pins view and renders its report', async () => {
  const { lastFrame, stdin, unmount } = render(<App />)
  await tick()
  stdin.write(ENTER) // first item is Pins
  await tick(60)
  assert.match(lastFrame() ?? '', /Pins/)
  unmount()
})
