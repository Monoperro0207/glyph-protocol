import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from 'ink-testing-library'
import { ActionFlow } from '../src/ui/ActionFlow.js'
import { App } from '../src/ui/App.js'

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ENTER = '\r'

test('ActionFlow shows the input prompt first and does not run anything', async () => {
  let calls = 0
  const { lastFrame, unmount } = render(
    <ActionFlow
      title="Approve a card"
      inputLabel="Card source"
      confirm={(v) => `Approve ${v}?`}
      run={async () => {
        calls++
        return { ok: true, report: 'done' }
      }}
    />,
  )
  await tick()
  assert.match(lastFrame() ?? '', /Card source/)
  assert.equal(calls, 0)
  unmount()
})

test('ActionFlow runs the action only after confirming with y', async () => {
  let ran: string | null = null
  const { lastFrame, stdin, unmount } = render(
    <ActionFlow
      title="Approve a card"
      inputLabel="Card source"
      confirm={(v) => `Approve ${v}?`}
      run={async (v) => {
        ran = v
        return { ok: true, report: `Approved ${v}` }
      }}
    />,
  )
  await tick()
  stdin.write('card.json')
  await tick()
  stdin.write(ENTER) // submit input → confirm step
  await tick()
  assert.match(lastFrame() ?? '', /Approve card\.json\?/)
  assert.match(lastFrame() ?? '', /Proceed\? \(y\/n\)/)
  assert.equal(ran, null) // nothing ran yet — confirm gate holds

  stdin.write('y')
  await tick(60)
  assert.equal(ran, 'card.json')
  assert.match(lastFrame() ?? '', /Approved card\.json/)
  unmount()
})

test('ActionFlow cancels back to input on n — never runs the action', async () => {
  let calls = 0
  const { lastFrame, stdin, unmount } = render(
    <ActionFlow
      title="Revoke a tool"
      inputLabel="Tool name"
      confirm={(v) => `Revoke ${v}?`}
      run={async () => {
        calls++
        return { ok: true, report: 'done' }
      }}
    />,
  )
  await tick()
  stdin.write('refund-payment')
  await tick()
  stdin.write(ENTER)
  await tick()
  assert.match(lastFrame() ?? '', /Proceed\? \(y\/n\)/)
  stdin.write('n') // decline
  await tick()
  assert.equal(calls, 0) // declined → never ran
  assert.match(lastFrame() ?? '', /Tool name/) // back to the input prompt
  unmount()
})

test('glyphp menu offers Approve and Revoke actions', async () => {
  const { lastFrame, unmount } = render(<App />)
  await tick()
  const frame = lastFrame() ?? ''
  assert.match(frame, /Approve/)
  assert.match(frame, /Revoke/)
  unmount()
})
