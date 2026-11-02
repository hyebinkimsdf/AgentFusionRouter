// What each turn of a runner-started Codex thread runs on. Codex keeps the
// model and effort a `turn/start` sets for every later turn, so the person's
// own choice (the baseline) and what the thread runs on now (current) are
// kept apart: a turn that sets nothing inherits the last routed setting.

import type { Analysis, RoutePolicy, Tier } from '@agent-fusion-router/core'
import { CODEX_MODELS, CODEX_TIER_DEFAULTS, DEFAULT_POLICY, analyzeTask, capabilityRank, findModel, route } from '@agent-fusion-router/core'

export type Setting = { model: string; effort?: string }

export type ThreadState = {
  /** What the person chose: the model and effort `thread/start` reported. */
  baseline: Setting
  /** What the thread runs on now, which a turn that sets nothing inherits. */
  current: Setting
  previousTier?: Tier
  /** The last verification command of the previous turn failed. */
  lastVerificationFailed: boolean
  /** Input tokens of the last request, cached ones included: the context's size. */
  contextTokens: number
}

/** A model as `model/list` reports it: only these, with these efforts, can be sent. */
export type ModelInfo = { id: string; efforts: string[]; defaultEffort?: string; hidden: boolean }

export type TurnPlan = {
  analysis: Analysis
  tier: Tier
  /** What the router chose for the turn; in observe mode, what it would have sent. */
  target: Setting
  /** What `turn/start` carries: only what differs from the thread's current setting, and only in route mode. */
  send: { model?: string; effort?: string }
  reasons: string[]
}

/**
 * Observe mode by default, and effort before models: changing effort alone
 * keeps the model, and is the first thing to measure. Standard work returns
 * to the baseline.
 */
export const RUNNER_POLICY: RoutePolicy = { ...DEFAULT_POLICY, mode: 'observe', strategy: 'effort', tiers: CODEX_TIER_DEFAULTS }

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const effortRank = (effort: string | undefined): number => (effort === undefined ? -1 : EFFORTS.indexOf(effort))

export const modelsFromList = (response: unknown): ModelInfo[] =>
  (((response as { data?: unknown[] } | undefined)?.data ?? []) as Record<string, unknown>[]).flatMap(m =>
    typeof m.id !== 'string'
      ? []
      : [
          {
            id: m.id,
            efforts: ((m.supportedReasoningEfforts ?? []) as ({ reasoningEffort?: string } | string)[]).map(e => (typeof e === 'string' ? e : (e.reasoningEffort ?? ''))).filter(e => e !== ''),
            ...(typeof m.defaultReasoningEffort === 'string' ? { defaultEffort: m.defaultReasoningEffort } : {}),
            hidden: m.hidden === true,
          },
        ],
  )

/** A tier target (`luna`, an id) as a model the account lists: the catalog's newest of that family first. */
export const resolveModel = (name: string, models: readonly ModelInfo[]): string | undefined => {
  const entry = findModel(name, CODEX_MODELS)
  const listed = models.filter(m => !m.hidden).map(m => m.id)
  if (listed.length === 0) return entry?.id ?? name
  if (listed.includes(name)) return name

  return CODEX_MODELS.filter(m => m.family === (entry?.family ?? name)).map(m => m.id).find(id => listed.includes(id))
}

/** The effort itself if the model takes it, else the highest it takes below it, else its default. */
const supportedEffort = (model: string, effort: string | undefined, models: readonly ModelInfo[], reasons: string[]): string | undefined => {
  const info = models.find(m => m.id === model)
  if (effort === undefined || info === undefined || info.efforts.length === 0 || info.efforts.includes(effort)) return effort

  reasons.push(`effort-unsupported:${effort}`)
  const below = info.efforts.filter(e => effortRank(e) <= effortRank(effort)).sort((a, b) => effortRank(b) - effortRank(a))[0]
  return below ?? info.defaultEffort
}

export const decideTurn = (state: ThreadState, prompt: string, policy: RoutePolicy, models: readonly ModelInfo[]): TurnPlan => {
  const analysis = analyzeTask(prompt)
  // The core decides the tier (confidence, follow-ups, failures); model and
  // effort are chosen here, against the baseline and the current setting.
  const bare = route(
    { analysis, currentModel: state.baseline.model, previousTier: state.previousTier, lastVerificationFailed: state.lastVerificationFailed },
    { ...policy, tiers: { light: {}, standard: {}, heavy: {} } },
  )
  const { tier } = bare
  const reasons = [...bare.reasons]
  const target = policy.tiers[tier]
  const { baseline, current } = state

  // The light tier never moves above the baseline, the heavy tier never below it.
  let model = baseline.model
  if (policy.strategy === 'model' && target.model !== undefined) {
    const id = resolveModel(target.model, models)
    const [from, to] = [capabilityRank(baseline.model), id === undefined ? undefined : capabilityRank(id)]
    if (id === undefined) reasons.push(`model-unavailable:${target.model}`)
    else if (from === undefined || to === undefined) reasons.push('model-held:unknown-model')
    else if (!(tier === 'light' && to > from) && !(tier === 'heavy' && to < from)) model = id
  }

  // Moving below what the thread runs on now re-reads the context into a cold cache.
  const [now, next] = [capabilityRank(current.model), capabilityRank(model)]
  if (now !== undefined && next !== undefined && next < now && state.contextTokens > policy.cacheGuardTokens) {
    reasons.push(`cache-guard:${state.contextTokens}`)
    model = current.model
  }

  let effort = target.effort ?? baseline.effort
  if (tier === 'heavy' && effortRank(effort) < effortRank(baseline.effort)) effort = baseline.effort
  if (tier === 'light' && baseline.effort !== undefined && effortRank(effort) > effortRank(baseline.effort)) effort = baseline.effort
  // Unlike Claude Code's, Codex's cache did not survive an effort change: on
  // Codex 0.164 the turn after one read 8,448 and then 0 tokens from the cache,
  // against 12,928 and 16,512 for turns that kept it. So a lower effort is held
  // like a smaller model; a higher one is never held.
  if (model === current.model && effortRank(effort) < effortRank(current.effort) && state.contextTokens > policy.cacheGuardTokens) {
    if (!reasons.some(r => r.startsWith('cache-guard:'))) reasons.push(`cache-guard:${state.contextTokens}`)
    effort = current.effort
  }
  effort = supportedEffort(model, effort, models, reasons)

  const chosen: Setting = { model, ...(effort === undefined ? {} : { effort }) }
  const send =
    policy.mode !== 'route'
      ? {}
      : {
          ...(chosen.model === current.model ? {} : { model: chosen.model }),
          ...(chosen.effort === undefined || chosen.effort === current.effort ? {} : { effort: chosen.effort }),
        }

  return { analysis, tier, target: chosen, send, reasons }
}

/** The thread after a turn: Codex keeps what the turn sent; the turn's tier and outcome feed the next decision. */
export const afterTurn = (state: ThreadState, plan: TurnPlan, outcome: { contextTokens?: number; lastVerification?: 'pass' | 'fail' }): ThreadState => ({
  ...state,
  current: { ...state.current, ...plan.send },
  previousTier: plan.tier,
  lastVerificationFailed: outcome.lastVerification === 'fail',
  contextTokens: outcome.contextTokens ?? state.contextTokens,
})
