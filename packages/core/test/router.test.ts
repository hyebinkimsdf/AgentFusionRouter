import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { analyzeTask } from '../src/analyzer.ts'
import { CODEX_MODELS, CODEX_TIER_DEFAULTS, capabilityRank, findModel } from '../src/catalog.ts'
import type { RoutePolicy } from '../src/router.ts'
import { DEFAULT_POLICY, route, routeSpawn } from '../src/router.ts'

const ROUTE: RoutePolicy = { ...DEFAULT_POLICY, mode: 'route' }

const OPUS = 'claude-opus-5-5'

describe('route', () => {
  test('a confident light task moves down to the light model', () => {
    const d = route({ analysis: analyzeTask('fix the typo in README.md'), currentModel: OPUS, currentEffort: 'medium' }, ROUTE)

    assert.equal(d.tier, 'light')
    assert.equal(d.model, 'haiku')
    assert.equal(d.effort, 'low')
    assert.equal(d.applied, true)
  })

  test('observe mode decides the same but applies nothing', () => {
    const d = route({ analysis: analyzeTask('fix the typo in README.md'), currentModel: OPUS })

    assert.equal(d.model, 'haiku')
    assert.equal(d.applied, false)
  })

  test('an unsure light task stays on the session model', () => {
    const analysis = analyzeTask('find where we parse config and change the timeout')
    assert.equal(analysis.tier, 'light')

    const d = route({ analysis, currentModel: OPUS }, ROUTE)

    assert.equal(d.tier, 'standard')
    assert.equal(d.model, undefined)
    assert.ok(d.reasons.some(r => r.startsWith('light-held')))
  })

  test('standard keeps whatever the person chose', () => {
    const d = route({ analysis: analyzeTask('add a settings page component'), currentModel: 'claude-sonnet-5-5' }, ROUTE)

    assert.equal(d.tier, 'standard')
    assert.equal(d.model, undefined)
    assert.equal(d.applied, false)
  })

  test('heavy moves up from a smaller model but never down', () => {
    const analysis = analyzeTask('design the architecture for multi-tenant billing')

    assert.equal(route({ analysis, currentModel: 'claude-sonnet-5-5' }, ROUTE).model, 'opus')
    assert.equal(route({ analysis, currentModel: 'claude-fable-5-1' }, ROUTE).model, undefined)
  })

  test('the cache guard holds a downgrade on a long context', () => {
    const d = route(
      { analysis: analyzeTask('fix the typo in README.md'), currentModel: OPUS, currentEffort: 'medium', contextTokens: 120_000 },
      ROUTE,
    )

    assert.equal(d.model, undefined)
    assert.equal(d.effort, 'low')
    assert.ok(d.reasons.includes('cache-guard:120000'))
  })

  test('the cache guard never holds an escalation', () => {
    const d = route(
      { analysis: analyzeTask('add a settings page'), currentModel: 'claude-sonnet-5-5', contextTokens: 500_000, escalations: 1 },
      ROUTE,
    )

    assert.equal(d.tier, 'heavy')
    assert.equal(d.model, 'opus')
  })

  test('a continuation keeps the previous tier', () => {
    const d = route({ analysis: analyzeTask('continue'), currentModel: 'claude-haiku-5-5', previousTier: 'light' }, ROUTE)

    assert.equal(d.tier, 'light')
  })

  test('a failure follow-up climbs one tier from the previous one', () => {
    const d = route({ analysis: analyzeTask('still failing'), currentModel: 'claude-haiku-5-5', previousTier: 'light' }, ROUTE)

    assert.equal(d.tier, 'standard')
    assert.ok(d.reasons.includes('escalate:previous-attempt-failed'))
  })

  test('a continuation after a failed verification climbs too', () => {
    const d = route(
      { analysis: analyzeTask('continue'), currentModel: 'claude-sonnet-5-5', previousTier: 'standard', lastVerificationFailed: true },
      ROUTE,
    )

    assert.equal(d.tier, 'heavy')
  })

  test('an unknown model is never switched away from', () => {
    const d = route({ analysis: analyzeTask('fix the typo in README.md'), currentModel: 'my-gateway-model' }, ROUTE)

    assert.equal(d.model, undefined)
    assert.ok(d.reasons.includes('model-held:unknown-model'))
  })

  test('the effort strategy never switches models', () => {
    const d = route(
      { analysis: analyzeTask('fix the typo in README.md'), currentModel: OPUS, currentEffort: 'medium' },
      { ...ROUTE, strategy: 'effort' },
    )

    assert.equal(d.model, undefined)
    assert.equal(d.effort, 'low')
  })

  test('no effort is set on a model that takes none', () => {
    const d = route({ analysis: analyzeTask('add a settings page'), currentModel: 'claude-sonnet-5-5' }, ROUTE)

    assert.equal(d.effort, undefined)
  })
})

describe('route on Codex', () => {
  const CODEX: RoutePolicy = { ...ROUTE, tiers: CODEX_TIER_DEFAULTS }
  const ASTRA = 'gpt-6-astra'

  test('Codex families rank as OpenAI orders them', () => {
    assert.deepEqual(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'].map(m => capabilityRank(m)), [0, 1, 2, 3])
  })

  test('a confident light task on Astra moves down to Luna', () => {
    const d = route({ analysis: analyzeTask('fix the typo in README.md'), currentModel: ASTRA, currentEffort: 'xhigh' }, CODEX)

    assert.equal(d.model, 'luna')
    assert.equal(findModel('luna', CODEX_MODELS)?.id, 'gpt-6-luna')
    assert.equal(d.effort, 'low')
  })

  test('the cache guard holds the same move on a long context', () => {
    const d = route({ analysis: analyzeTask('fix the typo in README.md'), currentModel: ASTRA, contextTokens: 120_000 }, CODEX)

    assert.equal(d.model, undefined)
    assert.ok(d.reasons.includes('cache-guard:120000'))
  })

  test('heavy work on Luna moves up to Astra, and never down from it', () => {
    const analysis = analyzeTask('redesign the authentication architecture across every service')

    assert.equal(route({ analysis, currentModel: 'gpt-6-luna' }, CODEX).model, 'astra')
    assert.equal(route({ analysis, currentModel: ASTRA }, CODEX).model, undefined)
  })

  test('Claude routing is unchanged by the Codex families', () => {
    assert.deepEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'].map(m => capabilityRank(m)), [0, 1, 2, 3])
    assert.equal(findModel('opus')?.id, 'claude-opus-5-5')
  })

  test('an unknown model that only contains a Codex family name stays unknown', () => {
    assert.equal(capabilityRank('my-console-model'), undefined)
    assert.equal(capabilityRank('solaris-gateway'), undefined)
    assert.equal(route({ analysis: analyzeTask('fix the typo in README.md'), currentModel: 'my-console-model' }, ROUTE).model, undefined)
  })

  test('the Codex price table holds OpenAI list prices and their long-context rows', () => {
    const astra = findModel('gpt-6-astra', CODEX_MODELS)

    assert.deepEqual(astra?.price, { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 })
    assert.equal(astra?.longContext?.aboveInputTokens, 272_000)
    assert.equal(findModel('gpt-6.1-sol', CODEX_MODELS)?.price.cacheRead, 0.1)
  })
})

describe('routeSpawn', () => {
  test('a confident light subagent moves down', () => {
    const d = routeSpawn({ analysis: analyzeTask('find all usages of the legacy logger'), parentModel: OPUS }, ROUTE)

    assert.equal(d.model, 'haiku')
    assert.equal(d.applied, true)
  })

  test('an explicit model is kept', () => {
    const d = routeSpawn(
      { analysis: analyzeTask('find all usages of the legacy logger'), parentModel: OPUS, requestedModel: 'sonnet' },
      ROUTE,
    )

    assert.equal(d.model, undefined)
  })

  test('anything but light inherits the parent', () => {
    const d = routeSpawn({ analysis: analyzeTask('design the billing architecture'), parentModel: 'claude-haiku-5-5' }, ROUTE)

    assert.equal(d.model, undefined)
  })
})
