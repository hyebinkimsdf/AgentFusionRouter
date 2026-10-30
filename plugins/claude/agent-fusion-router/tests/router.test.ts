// Runs the built hooks module against Claude Code's own engine:
//   claude plugin test plugins/claude/agent-fusion-router
// Each hook registered on `on` here stands for the engine beneath the plugin.

import type { EngineInterface, On, TurnStepInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

type Engine = { sent: string[]; efforts: unknown[]; written: string[] }

/**
 * Answers every engine call the plugin makes and records what reached the
 * bottom. Each response reports `cachedTokens` of context read from cache.
 */
const engine = (on: On, cachedTokens = 0): Engine => {
  const seen: Engine = { sent: [], efforts: [], written: [] }

  mock.env(on, { HOME: '/home/test' })
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.write', (_, e) => {
    seen.written.push(e.path)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    seen.sent.push(e.model)
    seen.efforts.push(e.effort)

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: e.model,
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: cachedTokens,
        cache_creation_input_tokens: 0,
      },
    }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  return seen
}

/** Raises one model request and reads its stream to the end. */
const step = async ($: EngineInterface, input: TurnStepInput): Promise<void> => {
  const stream = $.turn.step(input)
  for await (const _ of stream);
  await stream.result
}

const STEP = { model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as const

test('observe mode changes nothing and logs the step', async ($, on) => {
  const seen = engine(on)

  await $.turn.start({ text: 'fix the typo in README.md', turnId: 't1' })
  await step($, { ...STEP, turnId: 't1', index: 0 })

  expect(seen.sent).toEqual(['claude-opus-5-5'])
  expect(seen.written.length).toBe(1)
  // The engine resolves the path for the platform: `C:\home\test\...` on Windows.
  expect(seen.written[0]).toMatch(/home[\\/]test[\\/]\.agent-fusion-router[\\/]logs[\\/]\d{4}-\d\d-\d\d_session-1_\w+-0\.jsonl$/)
})

test('route mode sends a clear, small task to the light model', { options: { mode: 'route' } }, async ($, on) => {
  const seen = engine(on)

  await $.turn.start({ text: 'fix the typo in README.md', turnId: 't1' })
  await step($, { ...STEP, turnId: 't1', index: 0 })

  expect(seen.sent).toEqual(['haiku'])
  expect(seen.efforts).toEqual(['low'])
})

test('route mode leaves ordinary work on the session model', { options: { mode: 'route' } }, async ($, on) => {
  const seen = engine(on)

  await $.turn.start({ text: 'add a dark mode toggle component to the settings page', turnId: 't1' })
  await step($, { ...STEP, model: 'claude-sonnet-5-5', turnId: 't1', index: 0 })

  expect(seen.sent).toEqual(['claude-sonnet-5-5'])
})

test('two failed test runs move the rest of the turn up a tier', { options: { mode: 'route' } }, async ($, on) => {
  const seen = engine(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '1 failing' }, isError: true }) as never)

  await $.turn.start({ text: 'add a dark mode toggle component to the settings page', turnId: 't1' })
  await step($, { ...STEP, model: 'claude-sonnet-5-5', turnId: 't1', index: 0 })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await step($, { ...STEP, model: 'claude-sonnet-5-5', turnId: 't1', index: 1 })

  expect(seen.sent).toEqual(['claude-sonnet-5-5', 'opus'])
})

test('a long context keeps the model on a downgrade', { options: { mode: 'route' } }, async ($, on) => {
  const seen = engine(on, 200_000)

  // The first turn reports a large context; the second is light but stays put.
  await $.turn.start({ text: 'add a settings page component', turnId: 't1' })
  await step($, { ...STEP, turnId: 't1', index: 0 })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  await $.turn.start({ text: 'fix the typo in README.md', turnId: 't2' })
  await step($, { ...STEP, turnId: 't2', index: 0 })

  expect(seen.sent).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
  expect(seen.efforts.at(-1)).toBe('low')
})
