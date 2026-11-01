import type { Analysis } from './analyzer.ts'
import type { TierTarget } from './catalog.ts'
import { CLAUDE_TIER_DEFAULTS, capabilityRank } from './catalog.ts'
import type { Effort, Mode, Tier } from './types.ts'
import { bumpTier, tierRank } from './types.ts'

/**
 * `model` switches models per tier. `effort` keeps the session's model and
 * varies effort alone, which keeps the prompt cache (caches are per model).
 */
export type Strategy = 'model' | 'effort'

export type RoutePolicy = {
  mode: Mode
  strategy: Strategy
  tiers: Readonly<Record<Tier, TierTarget>>
  /** Below this the analyzer's "light" is treated as standard. */
  minLightConfidence: number
  /**
   * Context size in tokens above which a downgrade keeps the current model:
   * switching re-sends the whole context to a cold cache on the new model,
   * which can cost more than the cheaper model saves.
   */
  cacheGuardTokens: number
}

export const DEFAULT_POLICY: RoutePolicy = {
  mode: 'observe',
  strategy: 'model',
  tiers: CLAUDE_TIER_DEFAULTS,
  minLightConfidence: 0.5,
  cacheGuardTokens: 50_000,
}

export type RouteInput = {
  analysis: Analysis
  /** The model the engine is about to send. */
  currentModel: string
  /** The effort the engine is about to send; absent for a model without one. */
  currentEffort?: Effort | number
  /** The tier the previous turn of this loop ran at. */
  previousTier?: Tier
  /** The last verification command of this loop failed. */
  lastVerificationFailed?: boolean
  /** Input tokens of the last request in this loop, cached ones included. */
  contextTokens?: number
  /** Tiers to add for verification failures inside the current turn. */
  escalations?: number
}

export type Decision = {
  tier: Tier
  /** The model to send; absent keeps the engine's. */
  model?: string
  /** The effort to send; absent keeps the engine's. */
  effort?: Effort
  /** Why, as short tags. Safe to log. */
  reasons: string[]
  /** False in observe mode, or when there is nothing to change. */
  applied: boolean
}

/**
 * Picks the tier, then the model and effort, for one turn of the main loop.
 * Called at turn boundaries and after a failed verification, never per
 * request: every model switch costs a cache rewrite.
 */
export const route = (input: RouteInput, policy: RoutePolicy = DEFAULT_POLICY): Decision => {
  const { analysis } = input
  const reasons: string[] = []
  let tier = analysis.tier

  if (analysis.followUp && input.previousTier) {
    reasons.push(`follow-up:${analysis.followUp}`)

    if (analysis.followUp === 'failure' || input.lastVerificationFailed) {
      const bumped = bumpTier(input.previousTier)
      // A failure follow-up can also name harder new work than the attempt
      // that just failed; never let the previous tier cap it back down.
      tier = tierRank(tier) > tierRank(bumped) ? tier : bumped
      reasons.push('escalate:previous-attempt-failed')
    } else {
      tier = input.previousTier
    }
  } else if (tier === 'light' && analysis.confidence < policy.minLightConfidence) {
    tier = 'standard'
    reasons.push(`light-held:confidence-${analysis.confidence}`)
  } else {
    reasons.push(`analysis:${analysis.kind}`)
  }

  const escalations = input.escalations ?? 0
  if (escalations > 0) {
    tier = bumpTier(tier, escalations)
    reasons.push(`escalate:verification-failed-x${escalations}`)
  }

  const target = policy.tiers[tier]
  const model =
    policy.strategy === 'model' && target.model !== undefined
      ? pickModel(tier, target.model, input, policy, reasons)
      : undefined

  // A model that takes no effort has none to set, unless we switch models.
  const takesEffort = input.currentEffort !== undefined || model !== undefined
  const effort =
    takesEffort && target.effort !== undefined && target.effort !== input.currentEffort
      ? target.effort
      : undefined

  return {
    tier,
    model,
    effort,
    reasons,
    applied: policy.mode === 'route' && (model !== undefined || effort !== undefined),
  }
}

const pickModel = (
  tier: Tier,
  target: string,
  input: RouteInput,
  policy: RoutePolicy,
  reasons: string[],
): string | undefined => {
  const from = capabilityRank(input.currentModel)
  const to = capabilityRank(target)

  if (from === undefined || to === undefined) {
    reasons.push('model-held:unknown-model')
    return undefined
  }
  if (from === to) return undefined
  if (tier === 'light' && to > from) return undefined
  if (tier === 'heavy' && to < from) return undefined

  const context = input.contextTokens ?? 0
  if (to < from && context > policy.cacheGuardTokens) {
    reasons.push(`cache-guard:${context}`)
    return undefined
  }

  return target
}

export type SpawnInput = {
  analysis: Analysis
  /** The model the parent runs on, which the subagent inherits by default. */
  parentModel: string
  /** The model the Agent call named, if any. */
  requestedModel?: string
}

/**
 * Picks a subagent's model. Deliberately narrow: only a confident light task
 * moves down, an explicit choice is kept, and nothing moves up past the
 * parent. A new subagent starts with an empty context, so no cache is lost.
 */
export const routeSpawn = (input: SpawnInput, policy: RoutePolicy = DEFAULT_POLICY): Decision => {
  const { analysis } = input
  const isLight = analysis.tier === 'light' && analysis.confidence >= policy.minLightConfidence
  const tier: Tier = isLight ? 'light' : 'standard'
  const reasons = [`analysis:${analysis.kind}`]

  if (input.requestedModel !== undefined) {
    return { tier, reasons: [...reasons, 'model-held:requested'], applied: false }
  }

  const target = policy.tiers.light.model
  const from = capabilityRank(input.parentModel)
  const to = target === undefined ? undefined : capabilityRank(target)
  const isDowngrade = from !== undefined && to !== undefined && to < from
  const model = isLight && policy.strategy === 'model' && isDowngrade ? target : undefined

  return { tier, model, reasons, applied: policy.mode === 'route' && model !== undefined }
}
