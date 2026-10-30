import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { findModel } from '../src/catalog.ts'
import type { StepRecord, Tokens, UsageRecord } from '../src/usage.ts'
import { estimateCostUsd, formatReport, summarize } from '../src/usage.ts'

const tokens = (input: number, output: number, cacheRead = 0, cacheWrite = 0): Tokens => ({
  input,
  output,
  cacheRead,
  cacheWrite,
})

const step = (over: Partial<StepRecord>): StepRecord => ({
  v: 1,
  kind: 'step',
  ts: Date.UTC(2026, 9, 30),
  product: 'claude-code',
  session: 's1',
  turn: 't1',
  step: 0,
  mode: 'route',
  requestedModel: 'claude-opus-5-5',
  applied: false,
  ...over,
})

describe('findModel', () => {
  test('matches ids, suffixed ids and aliases', () => {
    assert.equal(findModel('claude-opus-5-5')?.id, 'claude-opus-5-5')
    assert.equal(findModel('claude-opus-5-20260101')?.id, 'claude-opus-5')
    assert.equal(findModel('claude-opus-5-5[1m]')?.id, 'claude-opus-5-5')
    assert.equal(findModel('haiku')?.id, 'claude-haiku-5-5')
    assert.equal(findModel('gpt-5'), undefined)
  })
})

describe('estimateCostUsd', () => {
  test('prices each token kind at its own rate', () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per MTok.
    const cost = estimateCostUsd(tokens(1_000_000, 100_000, 1_000_000, 100_000), 'claude-opus-5-5')

    assert.equal(cost?.toFixed(4), (4 + 2 + 0.2 + 0.5).toFixed(4))
  })

  test('uses the long-context price past the threshold', () => {
    const short = estimateCostUsd(tokens(100_000, 0), 'claude-haiku-5-5') ?? 0
    const long = estimateCostUsd(tokens(100_001, 0), 'claude-haiku-5-5') ?? 0

    assert.ok(long > short * 4)
  })

  test('an unknown model has no price', () => {
    assert.equal(estimateCostUsd(tokens(1, 1), 'mystery'), undefined)
  })
})

describe('summarize', () => {
  const records: UsageRecord[] = [
    step({ model: 'claude-opus-5-5', tokens: tokens(1000, 100) }),
    step({ step: 1, applied: true, decidedModel: 'haiku', model: 'claude-haiku-5-5', tokens: tokens(1000, 100) }),
    step({ session: 's2', mode: 'observe', decidedModel: 'haiku', model: 'claude-opus-5-5', tokens: tokens(1000, 100) }),
    step({ model: 'mystery-model', tokens: tokens(5, 5) }),
    {
      v: 1,
      kind: 'turn',
      ts: Date.UTC(2026, 9, 30),
      product: 'claude-code',
      session: 's1',
      turn: 't1',
      tier: 'light',
      outcome: 'answer',
      durationMs: 1200,
      verifyPasses: 1,
      verifyFailures: 2,
      escalations: 1,
    },
  ]

  const s = summarize(records)

  test('counts sessions, requests and turns', () => {
    assert.equal(s.sessions, 2)
    assert.equal(s.requests, 4)
    assert.equal(s.turns, 1)
    assert.equal(s.escalatedTurns, 1)
    assert.deepEqual(s.turnsByTier, { light: 1 })
  })

  test('separates applied from observed routing', () => {
    assert.equal(s.routedRequests, 1)
    assert.equal(s.wouldRouteRequests, 1)
  })

  test('prices the routed request at the requested model for comparison', () => {
    assert.ok(s.unroutedCostUsd > s.costUsd)
    assert.ok(s.potentialCostUsd < s.costUsd)
  })

  test('leaves unknown models out of the totals and names them', () => {
    assert.deepEqual(s.unpricedModels, ['mystery-model'])
    assert.equal(s.byModel.find(r => r.model === 'mystery-model')?.costUsd, undefined)
  })

  test('the report says estimates are not a bill', () => {
    const text = formatReport(s)

    assert.match(text, /not your bill/)
    assert.match(text, /claude-haiku-5-5/)
  })
})
