import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { UsageRecord } from '@agent-fusion-router/core'
import { CLAUDE_MODELS } from '@agent-fusion-router/core'

import { deriveResult, diffStats, hitLimit, parseClaudeOutput } from '../src/bench/derive.ts'
import { answerMatches } from '../src/bench/workspace.ts'
import { outsideConversationTokens, priceCheck, summarizeBench } from '../src/bench/summary.ts'
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

// Run 20261030-100520: 11 of 18 sessions ended like this, before any model answered.
const LIMIT_OUTPUT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  terminal_reason: 'api_error',
  api_error_status: 429,
  api_error: 'usage_limit_reached',
  result: "You've hit your 5-hour limit · resets 7:50pm (Asia/Seoul)",
  num_turns: 1,
  total_cost_usd: 0,
  modelUsage: {},
})

const OVERLOADED_OUTPUT = JSON.stringify({ ...(JSON.parse(LIMIT_OUTPUT) as object), api_error_status: 529, api_error: 'overloaded' })

// The result Claude Code 2.1.312 prints when --max-budget-usd stops a session (its result schema).
const BUDGET_OUTPUT = JSON.stringify({
  type: 'result',
  subtype: 'error_max_budget_usd',
  is_error: true,
  terminal_reason: 'budget_exhausted',
  num_turns: 6,
  total_cost_usd: 1.02,
  modelUsage: { 'claude-opus-5-5': { inputTokens: 10, outputTokens: 900, cacheReadInputTokens: 400000, cacheCreationInputTokens: 30000, costUSD: 1.02 } },
})

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

  test('reads an API error, and a usage limit as a limit', () => {
    const facts = parseClaudeOutput(LIMIT_OUTPUT)

    assert.deepEqual(facts?.apiErrors, [{ status: 429, error: 'usage_limit_reached' }])
    assert.equal(hitLimit(facts), true)
    assert.equal(parseClaudeOutput(CLAUDE_OUTPUT)?.apiErrors, undefined)
    assert.equal(hitLimit(parseClaudeOutput(CLAUDE_OUTPUT)), false)
  })

  test('an API error while planning is kept after the execute line', () => {
    const facts = parseClaudeOutput(`${OVERLOADED_OUTPUT}\n${CLAUDE_OUTPUT}\n`)

    assert.deepEqual(facts?.apiErrors, [{ status: 529, error: 'overloaded' }])
    assert.equal(hitLimit(facts), false, 'an overload is not a limit: later sessions may run')
  })

  test('a limit after another API error is still a limit', () => {
    const facts = parseClaudeOutput(`${OVERLOADED_OUTPUT}\n${LIMIT_OUTPUT}\n`)

    assert.deepEqual(facts?.apiErrors, [
      { status: 529, error: 'overloaded' },
      { status: 429, error: 'usage_limit_reached' },
    ])
    assert.equal(hitLimit(facts), true)
  })

  test('a limit in the plan and again in the execute is one limit, seen twice', () => {
    // Run 20261030-100520, rename-calc-total × opusplan: the plan stopped on its second turn.
    const facts = parseClaudeOutput(`${LIMIT_OUTPUT}\n${LIMIT_OUTPUT}\n`)

    assert.equal(facts?.apiErrors?.length, 2)
    assert.equal(hitLimit(facts), true)
  })

  test('reads a spent --max-budget-usd cap', () => {
    assert.equal(parseClaudeOutput(BUDGET_OUTPUT)?.budgetExhausted, true)
    assert.equal(parseClaudeOutput(CLAUDE_OUTPUT)?.budgetExhausted, false)
    assert.equal(parseClaudeOutput(LIMIT_OUTPUT)?.budgetExhausted, false)
  })
})

test('a plan-then-execute run takes totals from its last line and sums the conversation', () => {
  // Measured on 2026-10-30: opusplan planned on Opus, then a resumed session executed on Sonnet.
  // The second line's total and modelUsage include the first; each line's usage is its own.
  const plan = {
    total_cost_usd: 0.1184841,
    num_turns: 4,
    usage: { input_tokens: 8, output_tokens: 809, cache_read_input_tokens: 134873, cache_creation_input_tokens: 9396 },
    modelUsage: { 'claude-opus-5-5': { inputTokens: 8, outputTokens: 809, cacheReadInputTokens: 134873, cacheCreationInputTokens: 9396 } },
  }
  const execute = {
    total_cost_usd: 0.1804236,
    num_turns: 5,
    usage: { input_tokens: 8, output_tokens: 553, cache_read_input_tokens: 139415, cache_creation_input_tokens: 10613 },
    modelUsage: {
      'claude-opus-5-5': { inputTokens: 8, outputTokens: 809, cacheReadInputTokens: 134873, cacheCreationInputTokens: 9396 },
      'claude-sonnet-5-5': { inputTokens: 8, outputTokens: 553, cacheReadInputTokens: 139415, cacheCreationInputTokens: 10613 },
    },
  }
  const facts = parseClaudeOutput(`${JSON.stringify(plan)}\n${JSON.stringify(execute)}\n`)

  assert.equal(facts?.costUsd, 0.1804236)
  assert.deepEqual(Object.keys(facts?.byModel ?? {}), ['claude-opus-5-5', 'claude-sonnet-5-5'])
  assert.deepEqual(facts?.conversationTokens, { input: 16, output: 1362, cacheRead: 274288, cacheWrite: 20009 })
})

describe('priceCheck and outsideConversationTokens', () => {
  // Run 20261030-092454, add-remove-item on Sonnet 5.5, side requests on Haiku.
  const run = deriveResult({
    meta: META,
    claudeStdout: JSON.stringify({
      total_cost_usd: 0.0467,
      usage: { input_tokens: 6, output_tokens: 526, cache_read_input_tokens: 95986, cache_creation_input_tokens: 7921 },
      modelUsage: {
        'claude-haiku-5-5': { inputTokens: 1194, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0001294 },
        'claude-sonnet-5-5': { inputTokens: 6, outputTokens: 526, cacheReadInputTokens: 95986, cacheCreationInputTokens: 7921, costUSD: 0.0465546 },
      },
    }),
    records: [step({ model: 'claude-sonnet-5-5', tokens: { input: 6, output: 526, cacheRead: 95986, cacheWrite: 7921 } } as Partial<UsageRecord>)],
    check: PASSED,
    numstat: '',
    needsPlugin: true,
  })

  test('the current table computes what Claude Code computed, model by model', () => {
    assert.deepEqual(priceCheck(run, CLAUDE_MODELS), { checked: 2, agree: 2, differ: [] })
  })

  test('a wrong price shows as a disagreement', () => {
    const wrong = CLAUDE_MODELS.map(m => (m.id === 'claude-sonnet-5-5' ? { ...m, price: { ...m.price, cacheRead: 0.2 } } : m))
    const check = priceCheck(run, wrong)

    assert.equal(check.agree, 1)
    assert.equal(check.differ[0]?.model, 'claude-sonnet-5-5')
  })

  test('tokens outside the conversation come from Claude Code alone', () => {
    assert.deepEqual(outsideConversationTokens(run), { input: 1194, output: 20, cacheRead: 0, cacheWrite: 0 })
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

  test('a timeout counts as a failure, not an environment error', () => {
    const r = deriveResult({ meta: { ...META, timedOut: true }, claudeStdout: '', records: [], check: PASSED, numstat: '', needsPlugin: false })

    assert.equal(r.valid, true)
    assert.equal(r.timedOut, true)
    assert.equal(r.success, false, 'the task did not finish in budget, even though the check happened to pass')
  })

  test('a non-zero exit is invalid even when stdout parses as JSON', () => {
    const r = deriveResult({
      meta: { ...META, exitCode: 1 },
      claudeStdout: '{}',
      records: [],
      check: PASSED,
      numstat: '',
      needsPlugin: false,
    })

    assert.equal(r.valid, false)
    assert.match(r.invalidReason ?? '', /exited with code 1/)
  })

  test('a session that hit a usage limit is invalid, not a failed task, and says why', () => {
    // The hidden tests fail because nothing was changed; that says nothing about the model.
    const failed = { testsPassed: false, testsExitCode: 1 }
    for (const exitCode of [1, 0]) {
      const r = deriveResult({ meta: { ...META, exitCode }, claudeStdout: LIMIT_OUTPUT, records: [step()], check: failed, numstat: '', needsPlugin: true })

      assert.equal(r.valid, false)
      assert.equal(r.invalidReason, 'Claude Code stopped on an API error: usage_limit_reached (HTTP 429)')
    }
  })

  test('the reason names every API error, in order', () => {
    const r = deriveResult({ meta: { ...META, exitCode: 1 }, claudeStdout: `${OVERLOADED_OUTPUT}\n${LIMIT_OUTPUT}`, records: [], check: PASSED, numstat: '', needsPlugin: false })

    assert.equal(r.invalidReason, 'Claude Code stopped on an API error: overloaded (HTTP 529), then usage_limit_reached (HTTP 429)')
  })

  test('a spent budget is a counted failure, whatever the exit code, even when the check passes', () => {
    for (const exitCode of [1, 0]) {
      const r = deriveResult({ meta: { ...META, exitCode }, claudeStdout: BUDGET_OUTPUT, records: [step()], check: PASSED, numstat: '', needsPlugin: true })

      assert.equal(r.valid, true)
      assert.equal(r.success, false, 'the task did not finish in budget')
    }
  })

  test('a spent budget does not excuse a routing arm whose plugin recorded nothing', () => {
    const r = deriveResult({ meta: { ...META, exitCode: 1 }, claudeStdout: BUDGET_OUTPUT, records: [], check: PASSED, numstat: '', needsPlugin: true })

    assert.equal(r.valid, false)
    assert.match(r.invalidReason ?? '', /routing did not run/)
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

  test('what the run used counts the invalid runs the figures leave out', () => {
    const s = summarizeBench(tasks, arms, [...results, { ...result('a', 'auto', true, 9, false), rep: 2 }])

    assert.equal(s.spend.costUsd.toFixed(2), '9.95')
    assert.equal(s.spend.invalidCostUsd, 9)
    assert.equal(s.spend.unknownCostRuns, undefined)
  })

  test('a timeout lowers the success rate instead of being left out of it', () => {
    const timedOut = deriveResult({
      meta: { ...META, taskId: 'b', armId: 'auto', rep: 2, timedOut: true },
      claudeStdout: '',
      records: [step({ tier: 'standard' } as Partial<UsageRecord>)],
      check: PASSED,
      numstat: '',
      needsPlugin: true,
    })
    const auto = summarizeBench(tasks, arms, [...results, timedOut]).arms.find(a => a.armId === 'auto')

    // 1 success out of 3 valid runs, not 1 out of 2 with the timeout dropped.
    assert.equal(auto?.validRuns, 3)
    assert.equal(auto?.successRate.toFixed(2), '0.33')
  })

  test('an unknown session cost is never counted as $0', () => {
    const noCost = deriveResult({
      meta: { ...META, taskId: 'a', armId: 'fixed', rep: 2 },
      claudeStdout: JSON.stringify({ num_turns: 1 }),
      records: [],
      check: PASSED,
      numstat: '',
      needsPlugin: false,
    })
    const fixed = summarizeBench(tasks, arms, [...results, noCost]).arms.find(a => a.armId === 'fixed')

    assert.equal(fixed?.unknownCostRuns, 1)
    assert.equal(fixed?.costPerSuccessUsd, undefined)
    assert.equal(fixed?.differenceUsd, undefined)
  })

  test('like-for-like cost covers only the tasks every arm completed', () => {
    const s = summarizeBench(tasks, arms, results)

    assert.deepEqual(s.commonTasks, ['a'])
    assert.equal(s.arms.find(a => a.armId === 'fixed')?.commonTasksCostUsd?.toFixed(2), '0.20')
    assert.equal(s.arms.find(a => a.armId === 'auto')?.commonTasksCostUsd?.toFixed(2), '0.05')
  })

  test('the difference is signed: Claude Code computed − plugin estimate', () => {
    const auto = summarizeBench(tasks, arms, results).arms.find(a => a.armId === 'auto')
    const plugin = auto?.pluginEstimateUsd ?? 0

    assert.equal(auto?.differenceUsd?.toFixed(8), (0.35 - plugin).toFixed(8))
  })

  test('the classifier is scored against the expected tier', () => {
    const { classifier } = summarizeBench(tasks, arms, results)

    assert.equal(classifier.scored, 4)
    assert.equal(classifier.correct, 2)
    assert.equal(classifier.matrix.heavy.standard, 2)
  })
})
