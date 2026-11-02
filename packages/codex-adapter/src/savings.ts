// What Codex usage would cost at OpenAI's API list prices, and what it would
// have cost had this router chosen each turn's model: a simulation on the
// same token counts. Codex itself was never routed, so nothing here is a
// saving that happened.

import type { Analysis, Effort, ModelEntry, RoutePolicy, Tier, Tokens } from '@agent-fusion-router/core'
import { CODEX_MODELS, CODEX_PRICES_AS_OF, CODEX_TIER_DEFAULTS, DEFAULT_POLICY, capabilityRank, estimateCostUsd, findModel, route } from '@agent-fusion-router/core'

import type { CodexTokens, LedgerEntry } from './ledger.ts'

/**
 * Codex's counts in the core's terms. Codex counts cached input inside
 * `input`; the core prices uncached input, cache reads and cache writes
 * apart. Cache writes are taken to be inside `input` too: Codex has reported
 * none so far, so that is unconfirmed. Reasoning is inside `output` and is
 * billed as output.
 */
export const toCoreTokens = (t: CodexTokens): Tokens => ({
  input: Math.max(0, t.input - t.cachedInput - t.cacheWriteInput),
  output: t.output,
  cacheRead: t.cachedInput,
  cacheWrite: t.cacheWriteInput,
})

/** The router as it would run on Codex: route mode, Codex's tier targets, every other default as for Claude. */
export const CODEX_POLICY: RoutePolicy = { ...DEFAULT_POLICY, mode: 'route', tiers: CODEX_TIER_DEFAULTS }

/**
 * CODEX_POLICY with ordinary work sent to `model` instead of kept on the
 * turn's own, as the benchmark's auto arm sends it to Sonnet. Throws for a
 * model the price table does not know.
 */
export const codexPolicyWithStandard = (model: string, models: readonly ModelEntry[] = CODEX_MODELS): RoutePolicy => {
  if (findModel(model, models) === undefined) throw new Error(`no Codex model "${model}" in the price table: try ${[...new Set(models.map(m => m.family))].join(', ')} or a full id`)
  return { ...CODEX_POLICY, tiers: { ...CODEX_POLICY.tiers, standard: { model } } }
}

const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

export type TurnSimulation = {
  file: string
  turnId?: string
  /** The model the turn ran on. */
  model?: string
  /** What the router decided; absent where the turn had no prompt to read. */
  tier?: Tier
  /** The model the router would have sent; absent where it keeps the turn's own. */
  routedModel?: string
  reasons: string[]
  /** API list price of the turn's priced entries, as run. */
  actualUsd: number
  /** The same entries at the routed model; compaction stays at the model it ran on. */
  simulatedUsd: number
}

export type CodexCostSummary = {
  pricesAsOf: string
  /** The policy simulated: each tier's target model (absent keeps the turn's own) and the cache guard. */
  policy: { tiers: Record<Tier, string | undefined>; cacheGuardTokens: number }
  /** Every priced entry at API list prices, compaction included. */
  actualUsd: number
  /** The auto-compaction share of `actualUsd`. */
  compactionUsd: number
  /** The same entries had the router chosen each turn's model. */
  simulatedUsd: number
  /** actual − simulated: positive where routing would have cost less. */
  potentialSavingsUsd: number
  byModel: { model: string; isCompaction: boolean; requests: number; usd?: number }[]
  /** Models the price table lacks; their entries are left out of every figure here. */
  unpricedModels: string[]
  turns: {
    total: number
    /** Turns with a prompt the router could read. */
    analyzed: number
    movedDown: number
    movedUp: number
    /** Turns the router would have moved down, but the context was past the cache guard. */
    heldByCacheGuard: number
  }
  simulations: TurnSimulation[]
}

/** Prices `entries` and simulates routing them, turn by turn, file by file, in the order they ran. */
export const simulateCodexRouting = (
  entries: readonly LedgerEntry[],
  analyses: ReadonlyMap<string, ReadonlyMap<string, Analysis>>,
  policy: RoutePolicy = CODEX_POLICY,
  models: readonly ModelEntry[] = CODEX_MODELS,
): CodexCostSummary => {
  const unpriced = new Set<string>()
  const rows = new Map<string, { model: string; isCompaction: boolean; requests: number; usd?: number }>()
  const simulations: TurnSimulation[] = []
  const price = (e: LedgerEntry, model: string | undefined): number | undefined => {
    const usd = model === undefined ? undefined : estimateCostUsd(toCoreTokens(e.tokens), model, models)
    if (usd === undefined) unpriced.add(model ?? 'unknown')
    return usd
  }

  // Consecutive entries of one file and turn are one turn.
  const groups: LedgerEntry[][] = []
  for (const e of entries) {
    const last = groups.at(-1)?.[0]
    if (last !== undefined && last.file === e.file && last.turnId !== undefined && last.turnId === e.turnId) groups.at(-1)?.push(e)
    else groups.push([e])
  }

  let file: string | undefined
  let previousTier: Tier | undefined
  let contextTokens = 0

  for (const group of groups) {
    const first = group[0] as LedgerEntry
    if (first.file !== file) {
      file = first.file
      previousTier = undefined
      contextTokens = 0
    }

    const analysis = first.turnId === undefined ? undefined : analyses.get(first.file)?.get(first.turnId)
    const effort = first.effort !== undefined && EFFORTS.includes(first.effort) ? (first.effort as Effort) : undefined
    const decision =
      analysis === undefined || first.model === undefined
        ? undefined
        : route({ analysis, currentModel: first.model, currentEffort: effort, previousTier, contextTokens }, policy)
    const routedModel = decision?.model === undefined ? undefined : findModel(decision.model, models)?.id

    let actualUsd = 0
    let simulatedUsd = 0
    for (const [i, e] of group.entries()) {
      const actual = price(e, e.model)
      // A switch starts the new model with a cold cache: its first request reads all of its input uncached.
      const cold = i === 0 ? { ...e, tokens: { ...e.tokens, cachedInput: 0, cacheWriteInput: 0 } } : e
      const simulated = e.isCompaction || routedModel === undefined ? actual : price(cold, routedModel)
      const key = `${e.model ?? 'unknown'}\u0000${e.isCompaction}`
      const row = rows.get(key) ?? { model: e.model ?? 'unknown', isCompaction: e.isCompaction, requests: 0 }
      if (e.source === 'request_record') row.requests += 1
      if (actual !== undefined) row.usd = (row.usd ?? 0) + actual
      rows.set(key, row)
      if (actual === undefined || simulated === undefined) continue
      actualUsd += actual
      simulatedUsd += simulated
    }

    simulations.push({
      file: first.file,
      ...(first.turnId === undefined ? {} : { turnId: first.turnId }),
      ...(first.model === undefined ? {} : { model: first.model }),
      ...(decision === undefined ? {} : { tier: decision.tier }),
      ...(routedModel === undefined ? {} : { routedModel }),
      reasons: decision?.reasons ?? ['no-prompt'],
      actualUsd,
      simulatedUsd,
    })

    if (decision !== undefined) previousTier = decision.tier
    // A compaction request reads the context it is about to shrink: not the size the next turn starts from.
    const lastRequest = group.filter(e => e.source === 'request_record' && !e.isCompaction).at(-1)
    if (lastRequest !== undefined) contextTokens = lastRequest.tokens.input
  }

  const actualUsd = simulations.reduce((n, s) => n + s.actualUsd, 0)
  const simulatedUsd = simulations.reduce((n, s) => n + s.simulatedUsd, 0)
  const moved = (s: TurnSimulation): number => {
    const from = s.model === undefined ? undefined : capabilityRank(s.model)
    const to = s.routedModel === undefined ? undefined : capabilityRank(s.routedModel)
    return from === undefined || to === undefined ? 0 : Math.sign(to - from)
  }

  return {
    pricesAsOf: CODEX_PRICES_AS_OF,
    policy: {
      tiers: { light: policy.tiers.light.model, standard: policy.tiers.standard.model, heavy: policy.tiers.heavy.model },
      cacheGuardTokens: policy.cacheGuardTokens,
    },
    actualUsd,
    compactionUsd: [...rows.values()].filter(r => r.isCompaction).reduce((n, r) => n + (r.usd ?? 0), 0),
    simulatedUsd,
    potentialSavingsUsd: actualUsd - simulatedUsd,
    byModel: [...rows.values()].sort((a, b) => Number(a.isCompaction) - Number(b.isCompaction) || (b.usd ?? 0) - (a.usd ?? 0)),
    unpricedModels: [...unpriced].sort(),
    turns: {
      total: simulations.length,
      analyzed: simulations.filter(s => s.tier !== undefined).length,
      movedDown: simulations.filter(s => moved(s) < 0).length,
      movedUp: simulations.filter(s => moved(s) > 0).length,
      heldByCacheGuard: simulations.filter(s => s.reasons.some(r => r.startsWith('cache-guard:'))).length,
    },
    simulations,
  }
}
