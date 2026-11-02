import type { PluginOptions } from 'claude-code'

import type { Effort, EscalationPolicy, RoutePolicy, TierTarget } from '@agent-fusion-router/core'
import { CLAUDE_TIER_DEFAULTS, DEFAULT_ESCALATION, DEFAULT_POLICY } from '@agent-fusion-router/core'

export type Config = {
  policy: RoutePolicy
  escalation: EscalationPolicy
  routeSubagents: boolean
  showStatus: boolean
  /** Empty: `~/.agent-fusion-router/logs`. */
  logDir: string
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback

const count = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** A tier's model and effort from settings: an empty model keeps the session's, an empty effort the tier's default. */
const target = (model: unknown, effort: unknown, base: TierTarget): TierTarget => {
  const name = text(model, '')
  const level = EFFORTS.includes(effort as Effort) ? (effort as Effort) : base.effort

  return { ...(name === '' ? {} : { model: name }), ...(level === undefined ? {} : { effort: level }) }
}

/** The plugin's `userConfig` values, defaults filled in for anything unset or invalid. */
export const readConfig = (options: PluginOptions): Config => ({
  policy: {
    mode: oneOf(options.mode, ['observe', 'route'], DEFAULT_POLICY.mode),
    strategy: oneOf(options.strategy, ['model', 'effort'], DEFAULT_POLICY.strategy),
    tiers: {
      light: target(options.lightModel ?? CLAUDE_TIER_DEFAULTS.light.model, options.lightEffort, CLAUDE_TIER_DEFAULTS.light),
      standard: target(options.standardModel, options.standardEffort, CLAUDE_TIER_DEFAULTS.standard),
      heavy: target(options.heavyModel ?? CLAUDE_TIER_DEFAULTS.heavy.model, options.heavyEffort, CLAUDE_TIER_DEFAULTS.heavy),
    },
    minLightConfidence: count(options.minLightConfidence, DEFAULT_POLICY.minLightConfidence),
    cacheGuardTokens: count(options.cacheGuardTokens, DEFAULT_POLICY.cacheGuardTokens),
  },
  escalation: {
    failuresBeforeEscalation: count(options.failuresBeforeEscalation, DEFAULT_ESCALATION.failuresBeforeEscalation),
    maxEscalationsPerTurn: count(options.maxEscalationsPerTurn, DEFAULT_ESCALATION.maxEscalationsPerTurn),
  },
  routeSubagents: flag(options.routeSubagents, true),
  showStatus: flag(options.showStatus, true),
  logDir: text(options.logDir, ''),
})
