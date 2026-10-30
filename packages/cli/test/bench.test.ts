import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { UsageRecord } from '@agent-fusion-router/core'

import { deriveResult, diffStats, parseClaudeOutput } from '../src/bench/derive.ts'
import { answerMatches } from '../src/bench/workspace.ts'
import { summarizeBench } from '../src/bench/summary.ts'
import type { Arm, RunResult, Task } from '../src/bench/types.ts'

const CLAUDE_OUTPUT = JSON.stringify({
  type: 'result',
  is_error: false,
  duration_ms: 12000,
  num_turns: 4,
  result: 'src/pricing.js',
  total_cost_usd: 0.05,
  permission_denials: [{ tool_name: 'Bash' }],
  modelUsage: {
    'claude-haiku-5-5': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 200, costUSD: 0.01 },
    'claude-opus-5-5': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.04 },
  },
})

const step = (over: Partial<UsageRecord> = {}): UsageRecord =>
  ({
    v: 1,
    kind: 'step',
    ts: 0,
    product: 'claude-code',
    session: 's',
    turn: 't',
    step: 0,
    mode: 'route',
    tier: 'light',
    requestedModel: 'claude-opus-5-5',
    applied: true,
    model: 'claude-haiku-5-5',
    tokens: { input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 },
    ...over,
  }) as UsageRecord

const META = { taskId: 'a', armId: 'auto', rep: 1, simulated: false, startedAt: '', wallMs: 1000, exitCode: 0, timedOut: false }
const PASSED = { testsPassed: true, testsExitCode: 0 }

describe('parseClaudeOutput', () => {
  test('sums tokens across models and reads the totals', () => {
    const facts = parseClaudeOutput(`warning: something\n${CLAUDE_OUTPUT}\n`)

    assert.equal(facts?.costUsd, 0.05)
    assert.equal(facts?.numTurns, 4)
    assert.equal(facts?.permissionDenials, 1)
    assert.deepEqual(facts?.tokens, { input: 110, output: 55, cacheRead: 1000, cacheWrite: 200 })
  })

  test('no JSON is no result', () => {
    assert.equal(parseClaudeOutput('Error: not logged in'), undefined)
  })

  test('reads the conversation apart from side requests', () => {
    // Run 20261030-090215: modelUsage counts a side request the conversation's usage does not.
    const facts = parseClaudeOutput(
      JSON.stringify({
        usage: { input_tokens: 6, output_tokens: 363, cache_read_input_tokens: 95472, cache_creation_input_tokens: 7774 },
        modelUsage: {
          'claude-haiku-5-5': { inputTokens: 1200, outputTokens: 384, cacheReadInputTokens: 95472, cacheCreationInputTokens: 7774 },
        },
      }),
    )

    assert.deepEqual(facts?.conversationTokens, { input: 6, output: 363, cacheRead: 95472, cacheWrite: 7774 })
    assert.deepEqual(facts?.tokens, { input: 1200, output: 384, cacheRead: 95472, cacheWrite: 7774 })
  })
})

test('an answer matches whichever path separator it uses', () => {
  assert.equal(answerMatches('src\\pricing.js', ['src/pricing.js']), true)
  assert.equal(answerMatches('The rate is in src/pricing.js.', ['src/pricing.js']), true)
  assert.equal(answerMatches('src/cart.js', ['src/pricing.js']), false)
})

describe('deriveResult', () => {
  test('a route arm whose plugin recorded nothing is invalid', () => {
    const r = deriveResult({ meta: META, claudeStdout: CLAUDE_OUTPUT, records: [], check: PASSED, numstat: '', needsPlugin: true })

    assert.equal(r.valid, false)
    assert.match(r.invalidReason ?? '', /routing did not run/)
  })

  test('an observe arm without plugin records is still valid', () => {
    const r = deriveResult({ meta: META, claudeStdout: CLAUDE_OUTPUT, records: [], check: PASSED, numstat: '', needsPlugin: false })

    assert.equal(r.valid, true)
  })

  test('a wrong answer fails even when the tests pass', () => {
    const r = deriveResult({
      meta: META,
      claudeStdout: CLAUDE_OUTPUT,
      records: [step()],
      check: { ...PASSED, answerOk: false },
      numstat: '',
      needsPlugin: true,
    })

    assert.equal(r.success, false)
  })

  test('a timeout is invalid', () => {
    const r = deriveResult({ meta: { ...META, timedOut: true }, claudeStdout: '', records: [], check: PASSED, numstat: '', needsPlugin: false })

    assert.equal(r.invalidReason, 'timed out')
  })

  test('the first main-loop step gives the router tier', () => {
    const r = deriveResult({
      meta: META,
      claudeStdout: CLAUDE_OUTPUT,
      records: [step({ agent: 'sub-1', tier: 'heavy' } as Partial<UsageRecord>), step()],
      check: PASSED,
      numstat: '',
      needsPlugin: true,
    })

    assert.equal(r.plugin.decidedTier, 'light')
    assert.equal(r.plugin.requests, 2)
  })
})

test('diffStats counts files and lines', () => {
  assert.deepEqual(diffStats('3\t1\tsrc/a.js\n0\t2\tsrc/b.js\n-\t-\timg.png\n'), { files: 3, added: 3, removed: 3 })
})

describe('summarizeBench', () => {
  const tasks: Task[] = [
    { id: 'a', kind: 'lookup', expectedTier: 'light', prompt: '' },
    { id: 'b', kind: 'design', expectedTier: 'heavy', prompt: '' },
  ]
  const arms: Arm[] = [
    { id: 'fixed', label: 'Fixed', model: 'opus', plugin: { mode: 'observe' } },
    { id: 'auto', label: 'Auto', model: 'opus', plugin: { mode: 'route' } },
  ]
  const result = (taskId: string, armId: string, success: boolean, cost: number, valid = true): RunResult =>
    deriveResult({
      meta: { ...META, taskId, armId },
      claudeStdout: JSON.stringify({ total_cost_usd: cost, num_turns: 1 }),
      records: valid ? [step({ tier: taskId === 'a' ? 'light' : 'standard' } as Partial<UsageRecord>)] : [],
      check: { testsPassed: success, testsExitCode: success ? 0 : 1 },
      numstat: '',
      needsPlugin: armId === 'auto',
    })

  const results = [
    result('b', 'auto', false, 0.3),
    result('a', 'fixed', true, 0.2),
    result('a', 'auto', true, 0.05),
    result('b', 'fixed', true, 0.4),
  ]

  test('cost per completed task counts the failures', () => {
    const auto = summarizeBench(tasks, arms, results).arms.find(a => a.armId === 'auto')

    assert.equal(auto?.successes, 1)
    assert.equal(auto?.costPerSuccessUsd?.toFixed(2), '0.35')
  })

  test('the summary does not depend on the order runs come in', () => {
    assert.deepEqual(summarizeBench(tasks, arms, results), summarizeBench(tasks, arms, [...results].reverse()))
  })

  test('invalid runs are listed and never counted', () => {
    const s = summarizeBench(tasks, arms, [...results, { ...result('a', 'auto', true, 9, false), rep: 2 }])

    assert.equal(s.invalid.length, 1)
    assert.equal(s.arms.find(a => a.armId === 'auto')?.costUsd.toFixed(2), '0.35')
  })

  test('the classifier is scored against the expected tier', () => {
    const { classifier } = summarizeBench(tasks, arms, results)

    assert.equal(classifier.scored, 4)
    assert.equal(classifier.correct, 2)
    assert.equal(classifier.matrix.heavy.standard, 2)
  })
})
