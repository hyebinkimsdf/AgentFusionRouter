import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { describe, test } from 'node:test'

import type { UsageRecord } from '@agent-fusion-router/core'

import type { ModelInfo, ThreadState } from '../src/index.ts'
import { RUNNER_POLICY, afterTurn, connect, decideTurn, openSession } from '../src/index.ts'

const ALL = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
// As `model/list` reported them on Codex 0.164.
const MODELS: ModelInfo[] = [
  { id: 'gpt-6.1-sol', efforts: ALL, defaultEffort: 'low', hidden: false },
  { id: 'gpt-6-astra', efforts: ALL, defaultEffort: 'low', hidden: false },
  { id: 'gpt-6.1-terra', efforts: ALL, defaultEffort: 'low', hidden: false },
  { id: 'gpt-6-luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', hidden: false },
]
const LIGHT = 'where is parseConfig defined?'
const STANDARD = 'add a removeItem function to src/cart.js'
const HEAVY = 'design the architecture for multi-tenant billing'

const fresh = (model = 'gpt-6-astra', effort = 'xhigh'): ThreadState => ({ baseline: { model, effort }, current: { model, effort }, lastVerificationFailed: false, contextTokens: 0 })
const routeEffort = { ...RUNNER_POLICY, mode: 'route' as const }
const routeModel = { ...RUNNER_POLICY, mode: 'route' as const, strategy: 'model' as const }

describe('decideTurn', () => {
  test('observe mode sends nothing, and the thread stays on the baseline', () => {
    const plan = decideTurn(fresh(), LIGHT, RUNNER_POLICY, MODELS)

    assert.deepEqual(plan.target, { model: 'gpt-6-astra', effort: 'low' })
    assert.deepEqual(plan.send, {})
    assert.deepEqual(afterTurn(fresh(), plan, {}).current, fresh().current)
  })

  test('the effort strategy keeps the model; standard work returns to the baseline effort', () => {
    const light = decideTurn(fresh(), LIGHT, routeEffort, MODELS)
    assert.deepEqual(light.send, { effort: 'low' })

    // Codex keeps `low` for the next turn unless it is sent back.
    const after = afterTurn(fresh(), light, {})
    assert.deepEqual(after.current, { model: 'gpt-6-astra', effort: 'low' })
    assert.deepEqual(decideTurn(after, STANDARD, routeEffort, MODELS).send, { effort: 'xhigh' })
  })

  test('heavy work never lowers the baseline effort, and light work never raises it', () => {
    assert.equal(decideTurn(fresh(), HEAVY, routeEffort, MODELS).target.effort, 'xhigh', 'xhigh, not the heavy tier\'s high')
    assert.equal(decideTurn(fresh('gpt-6-astra', 'low'), HEAVY, routeEffort, MODELS).target.effort, 'high')
    assert.equal(decideTurn(fresh('gpt-6-astra', 'low'), LIGHT, routeEffort, MODELS).target.effort, 'low')
  })

  test('the model strategy moves light work to Luna and standard work back to the baseline', () => {
    const light = decideTurn(fresh(), LIGHT, routeModel, MODELS)
    assert.deepEqual(light.send, { model: 'gpt-6-luna', effort: 'low' })

    const back = decideTurn({ ...afterTurn(fresh(), light, { contextTokens: 120_000 }) }, STANDARD, routeModel, MODELS)
    assert.deepEqual(back.send, { model: 'gpt-6-astra', effort: 'xhigh' }, 'moving up is never held by the cache guard')
  })

  test('the cache guard compares with what the thread runs on now, not the baseline', () => {
    const plan = decideTurn({ ...fresh(), contextTokens: 80_000 }, LIGHT, routeModel, MODELS)

    assert.equal(plan.target.model, 'gpt-6-astra')
    assert.ok(plan.reasons.includes('cache-guard:80000'))
    assert.deepEqual(plan.send, {}, 'a lower effort is held too: Codex dropped its cache on an effort change')
  })

  test('past the cache guard a lower effort is held, and a higher one is not', () => {
    const big = { ...fresh(), contextTokens: 80_000 }
    assert.deepEqual(decideTurn(big, LIGHT, routeEffort, MODELS).send, {})

    const low = { ...big, current: { model: 'gpt-6-astra', effort: 'low' } }
    assert.deepEqual(decideTurn(low, STANDARD, routeEffort, MODELS).send, { effort: 'xhigh' })
    assert.deepEqual(decideTurn({ ...fresh(), contextTokens: 20_000 }, LIGHT, routeEffort, MODELS).send, { effort: 'low' })
  })

  test('only models and efforts the account lists are sent', () => {
    const noLuna = MODELS.filter(m => m.id !== 'gpt-6-luna')
    assert.equal(decideTurn(fresh(), LIGHT, routeModel, noLuna).target.model, 'gpt-6-astra')
    assert.ok(decideTurn(fresh(), LIGHT, routeModel, noLuna).reasons.includes('model-unavailable:luna'))

    // A baseline of ultra on a heavy turn, on an Astra that tops out at max.
    const capped = MODELS.map(m => (m.id === 'gpt-6-astra' ? { ...m, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] } : m))
    const heavy = decideTurn(fresh('gpt-6.1-sol', 'ultra'), HEAVY, routeModel, capped)
    assert.deepEqual(heavy.target, { model: 'gpt-6-astra', effort: 'max' })
  })

  test('a continuation after a failed verification moves up a tier', () => {
    const state = { ...fresh(), previousTier: 'standard' as const, lastVerificationFailed: true }

    assert.equal(decideTurn(state, '계속해', routeEffort, MODELS).tier, 'heavy')
  })
})

// A stand-in for `codex app-server`: answers requests and plays a turn's notifications.
const fakeServer = (script: (method: string, params: Record<string, unknown>, emit: (method: string, params: object) => void) => unknown) => {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const sent: { method: string; params: Record<string, unknown> }[] = []
  const emit = (method: string, params: object) => toClient.write(`${JSON.stringify({ method, params })}\n`)
  let buffer = ''
  toServer.on('data', chunk => {
    buffer += String(chunk)
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, i)) as { id?: number; method?: string; params?: Record<string, unknown> }
      buffer = buffer.slice(i + 1)
      if (message.id === undefined || message.method === undefined) continue
      sent.push({ method: message.method, params: message.params ?? {} })
      const result = script(message.method, message.params ?? {}, emit)
      toClient.write(`${JSON.stringify({ id: message.id, result })}\n`)
    }
  })

  return { server: connect({ input: toClient, output: toServer }, async () => ({ decision: 'decline' })), sent }
}

const usage = (turnId: string, last: number, total: number) => ({
  threadId: 'th-1',
  turnId,
  tokenUsage: {
    last: { inputTokens: last, cachedInputTokens: last - 100, cacheWriteInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0, totalTokens: last + 5 },
    total: { inputTokens: total, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: total },
  },
})

describe('openSession', () => {
  const script = (method: string, params: Record<string, unknown>, emit: (m: string, p: object) => void) => {
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus', email: 'someone@example.com' }, requiresOpenaiAuth: true }
    if (method === 'model/list') return { data: MODELS.map(m => ({ id: m.id, supportedReasoningEfforts: m.efforts.map(reasoningEffort => ({ reasoningEffort })), defaultReasoningEffort: m.defaultEffort, hidden: m.hidden })) }
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 78, windowDurationMins: 300 }, secondary: { usedPercent: 98, windowDurationMins: 10_080 } } }
    if (method === 'thread/start') return { thread: { id: 'th-1' }, model: 'gpt-6-astra', reasoningEffort: 'xhigh' }
    if (method === 'turn/start') {
      const id = `turn-${String(params.input).length}-${Math.random()}`
      // One usage notification before turn/start has answered, as can happen.
      emit('thread/tokenUsage/updated', usage(id, 16_000, 16_005))
      setImmediate(() => {
        emit('item/completed', { threadId: 'th-1', turnId: id, item: { type: 'commandExecution', command: 'npm test', exitCode: 1 } })
        emit('thread/tokenUsage/updated', usage(id, 16_100, 32_110))
        emit('thread/tokenUsage/updated', usage(id, 16_100, 32_110))
        emit('turn/completed', { threadId: 'th-1', turn: { id, status: 'completed', durationMs: 1200 } })
      })
      return { turn: { id } }
    }
    return {}
  }

  test('a session takes its baseline from Codex, keeps no email, and reads the plan limits', async () => {
    const { server } = fakeServer(script)
    const session = await openSession(server, { cwd: '.', policy: RUNNER_POLICY, log: () => {} })

    assert.deepEqual(session.info.baseline, { model: 'gpt-6-astra', effort: 'xhigh' })
    assert.deepEqual(session.info.account, { type: 'chatgpt', planType: 'plus' })
    assert.equal(session.info.limits?.secondary?.usedPercent, 98)
  })

  test('each request is logged once, and the next turn sends the baseline back', async () => {
    const { server, sent } = fakeServer(script)
    const records: UsageRecord[] = []
    const session = await openSession(server, { cwd: '.', policy: { ...RUNNER_POLICY, mode: 'route' }, log: r => void records.push(r) })

    const first = await session.runTurn(LIGHT)
    assert.equal(first.requests.length, 2, 'the repeated notification is skipped')
    assert.equal(first.verification.failures, 1)
    assert.deepEqual(first.ran, { model: 'gpt-6-astra', effort: 'low' })

    const steps = records.filter(r => r.kind === 'step')
    assert.equal(steps.length, 2)
    assert.deepEqual(
      steps.map(s => (s.kind === 'step' ? [s.product, s.requestedModel, s.requestedEffort, s.effort, s.applied, s.tokens?.cacheRead] : [])),
      [
        ['codex', 'gpt-6-astra', 'xhigh', 'low', true, 15_900],
        ['codex', 'gpt-6-astra', 'xhigh', 'low', true, 16_000],
      ],
    )
    const turn = records.at(-1)
    assert.equal(turn?.kind, 'turn')
    assert.equal(turn?.kind === 'turn' ? turn.verifyFailures : undefined, 1)

    await session.runTurn(STANDARD)
    const turns = sent.filter(s => s.method === 'turn/start')
    assert.equal(turns[0]?.params.effort, 'low')
    assert.equal(turns[1]?.params.effort, 'xhigh')
    assert.equal(session.state().contextTokens, 16_100)
  })

  test('observe mode starts every turn with nothing set', async () => {
    const { server, sent } = fakeServer(script)
    const session = await openSession(server, { cwd: '.', policy: RUNNER_POLICY, log: () => {} })
    await session.runTurn(LIGHT)

    const turn = sent.find(s => s.method === 'turn/start')
    assert.equal(turn?.params.model, undefined)
    assert.equal(turn?.params.effort, undefined)
  })
})
