import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { analyzeTurns, codexPolicyWithStandard, parseSessionLedger, requestText, simulateCodexRouting, toCoreTokens } from '../src/index.ts'

// A session in the shape Codex writes, with prompts, for the routing simulation.
let clock = 0
const line = (type: string, payload: object) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 0, 1) + (clock += 1000)).toISOString(), type, payload })
const turn = (turnId: string, model = 'gpt-6-astra') => [
  line('event_msg', { type: 'task_started', turn_id: turnId }),
  line('turn_context', { turn_id: turnId, model, effort: 'xhigh' }),
]
const prompt = (message: string) => line('event_msg', { type: 'user_message', message })
const request = (responseId: string, turnId: string, input: number, cached: number, output: number) =>
  line('token_usage_record', {
    session_id: 's-1',
    turn_id: turnId,
    response_id: responseId,
    usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output },
  })
const rollout = (...lines: (string | string[])[]) => `${lines.flat().join('\n')}\n`

const simulate = (text: string) => {
  const ledger = parseSessionLedger(text, 'f')
  return simulateCodexRouting(ledger.entries, new Map([['f', analyzeTurns(text)]]))
}

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)

describe('the prompt the router reads', () => {
  const IDE = '# Context from my IDE setup:\n\n## Open tabs:\n- src/app.ts: src/app.ts\n\n## My request:\n'

  test('the IDE context in front of a request is left out', () => {
    assert.equal(requestText(`${IDE}fix the typo in README.md`), 'fix the typo in README.md')
  })

  test('the request keeps its own headings, and a message without IDE context is taken whole', () => {
    assert.equal(requestText(`${IDE}## Plan\nredo it`), '## Plan\nredo it')
    assert.equal(requestText('## My request:\nnot from the IDE'), '## My request:\nnot from the IDE')
  })

  test("each turn is analyzed from its first prompt, and no text leaves", () => {
    const analyses = analyzeTurns(rollout(turn('t-1'), prompt(`${IDE}fix the typo in README.md SECRET`), prompt('also redesign everything'), turn('t-2'), prompt('continue')))

    assert.deepEqual([...analyses.keys()], ['t-1', 't-2'])
    assert.equal(analyses.get('t-1')?.tier, 'light')
    assert.equal(analyses.get('t-2')?.followUp, 'continue')
    assert.doesNotMatch(JSON.stringify([...analyses.values()]), /SECRET|README|typo/)
  })

  test('a turn with no user_message event takes its prompt from the user message item, without injected context', () => {
    const item = (...texts: string[]) => line('response_item', { type: 'message', role: 'user', content: texts.map(text => ({ type: 'input_text', text })) })
    const analyses = analyzeTurns(rollout(turn('t-1'), item('<environment_context>\n  <cwd>D:\\app</cwd>\n</environment_context>'), item('fix the typo in README.md')))

    assert.equal(analyses.get('t-1')?.tier, 'light')
    assert.equal(analyses.get('t-1')?.signals.some(s => s.includes('cwd')), false)
  })

  test('the user_message event wins over the message item when a turn has both', () => {
    const analyses = analyzeTurns(
      rollout(turn('t-1'), line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'redesign the whole system architecture' }] }), prompt('fix the typo in README.md')),
    )

    assert.equal(analyses.get('t-1')?.tier, 'light')
  })
})

describe('Codex costs at API list prices', () => {
  test("Codex's input holds its cached input; the core's does not", () => {
    assert.deepEqual(toCoreTokens({ input: 100, cachedInput: 90, cacheWriteInput: 0, output: 7, reasoningOutput: 3, total: 107 }), { input: 10, output: 7, cacheRead: 90, cacheWrite: 0 })
  })

  test('a request on Astra is priced from the table', () => {
    // 10,000 uncached × $10 + 90,000 cached × $1 + 1,000 output × $50, per million.
    const c = simulate(rollout(turn('t-1'), request('r1', 't-1', 100_000, 90_000, 1_000)))

    close(c.actualUsd, 0.1 + 0.09 + 0.05)
  })

  test('a model the table lacks is left out and named', () => {
    const c = simulate(rollout(turn('t-1', 'gpt-9-mystery'), request('r1', 't-1', 100, 0, 10)))

    assert.equal(c.actualUsd, 0)
    assert.deepEqual(c.unpricedModels, ['gpt-9-mystery'])
  })
})

describe('what routing each turn would have cost', () => {
  test('a light first turn moves to Luna, its first request with a cold cache', () => {
    const c = simulate(rollout(turn('t-1'), prompt('fix the typo in README.md'), request('r1', 't-1', 100_000, 90_000, 1_000), request('r2', 't-1', 100_000, 90_000, 1_000)))

    assert.equal(c.simulations[0]?.routedModel, 'gpt-6-luna')
    close(c.actualUsd, 2 * 0.24)
    // Luna: r1 all 100,000 input uncached × $0.10 + 1,000 × $0.50; r2 10,000 × $0.10 + 90,000 × $0.01 + 1,000 × $0.50.
    close(c.simulatedUsd, 0.0105 + 0.0024)
    close(c.potentialSavingsUsd, 2 * 0.24 - 0.0129)
    assert.equal(c.turns.movedDown, 1)
  })

  test('the same move is held once the context is past the cache guard', () => {
    const c = simulate(rollout(turn('t-1'), prompt('explain how the build works'), request('r1', 't-1', 120_000, 0, 1_000), turn('t-2'), prompt('fix the typo in README.md'), request('r2', 't-2', 121_000, 120_000, 100)))

    const held = c.simulations[1]
    assert.equal(held?.routedModel, undefined)
    assert.ok(held?.reasons.includes('cache-guard:120000'))
    assert.equal(held?.simulatedUsd, held?.actualUsd)
    assert.equal(c.turns.heldByCacheGuard, 1)
  })

  test('auto-compaction stays on the model it ran on, even in a turn that moves', () => {
    const text = rollout(
      turn('t-1'),
      prompt('fix the typo in README.md'),
      request('r1', 't-1', 10_000, 0, 100),
      request('c1', 't-1', 10_000, 0, 100),
      line('compacted', { compaction_response_id: 'c1' }),
    )
    const c = simulate(text)

    // r1 moves to Luna; c1 stays on Astra: 10,000 × $10 + 100 × $50, per million.
    close(c.compactionUsd, 0.105)
    close(c.simulatedUsd, 10_000 * 0.1 / 1e6 + 100 * 0.5 / 1e6 + 0.105)
  })

  test('heavy work on Luna moves up, and the simulation can cost more', () => {
    const c = simulate(rollout(turn('t-1', 'gpt-6-luna'), prompt('redesign the authentication architecture across every service'), request('r1', 't-1', 10_000, 0, 1_000)))

    assert.equal(c.simulations[0]?.routedModel, 'gpt-6-astra')
    assert.equal(c.turns.movedUp, 1)
    assert.ok(c.potentialSavingsUsd < 0)
  })

  test('ordinary work stays on its own model by default, and moves only when a standard model is named', () => {
    const text = rollout(turn('t-1'), prompt('add a remove button to the cart page'), request('r1', 't-1', 10_000, 0, 1_000))
    const ledger = parseSessionLedger(text, 'f')
    const analyses = new Map([['f', analyzeTurns(text)]])

    assert.equal(analyses.get('f')?.get('t-1')?.tier, 'standard')
    assert.equal(simulateCodexRouting(ledger.entries, analyses).simulations[0]?.routedModel, undefined)
    const sol = simulateCodexRouting(ledger.entries, analyses, codexPolicyWithStandard('sol'))
    assert.equal(sol.simulations[0]?.routedModel, 'gpt-6.1-sol')
    assert.equal(sol.policy.tiers.standard, 'sol')
    assert.throws(() => codexPolicyWithStandard('gpt-9-mystery'), /no Codex model "gpt-9-mystery"/)
  })

  test('a turn with no prompt to read keeps its model', () => {
    const c = simulate(rollout(turn('t-1'), request('r1', 't-1', 10_000, 0, 100)))

    assert.deepEqual(c.simulations[0]?.reasons, ['no-prompt'])
    assert.equal(c.turns.analyzed, 0)
    assert.equal(c.potentialSavingsUsd, 0)
  })
})
