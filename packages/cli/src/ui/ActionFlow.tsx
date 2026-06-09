import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { type JSX, useState } from 'react'

export interface ActionResult {
  ok: boolean
  report: string
}

export interface ActionFlowProps {
  title: string
  /** Prompt shown next to the text input. */
  inputLabel: string
  /** Builds the confirmation line from the entered value. */
  confirm: (value: string) => string
  /** Runs the action. Only called after explicit y/confirm. */
  run: (value: string) => Promise<ActionResult>
}

type Step = 'input' | 'confirm' | 'running' | 'done'

/**
 * A three-step interactive write flow: type an argument, confirm (the gate for
 * every irreversible action), then run. Nothing executes until the user presses
 * `y` at the confirm step — typing or `esc` never triggers the action.
 */
export function ActionFlow({ title, inputLabel, confirm, run }: ActionFlowProps): JSX.Element {
  const [step, setStep] = useState<Step>('input')
  const [value, setValue] = useState('')
  const [result, setResult] = useState<ActionResult | null>(null)

  useInput(
    (input, key) => {
      if (step === 'confirm') {
        if (input === 'y' || input === 'Y') {
          setStep('running')
          run(value)
            .then((r) => {
              setResult(r)
              setStep('done')
            })
            .catch((e) => {
              setResult({ ok: false, report: String(e?.message ?? e) })
              setStep('done')
            })
        } else if (input === 'n' || input === 'N' || key.escape) {
          setStep('input')
        }
      }
    },
    { isActive: step === 'confirm' },
  )

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {title}
      </Text>

      {step === 'input' && (
        <Box marginTop={1}>
          <Text>{inputLabel}: </Text>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={() => value && setStep('confirm')}
          />
        </Box>
      )}

      {step === 'confirm' && (
        <Box marginTop={1} flexDirection="column">
          <Text>{confirm(value)}</Text>
          <Text color="yellow">Proceed? (y/n)</Text>
        </Box>
      )}

      {step === 'running' && (
        <Box marginTop={1}>
          <Text dimColor>running…</Text>
        </Box>
      )}

      {step === 'done' && result && (
        <Box marginTop={1} flexDirection="column">
          <Text color={result.ok ? 'green' : 'red'}>{result.report}</Text>
          <Box marginTop={1}>
            <Text dimColor>esc / q — back to menu</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
