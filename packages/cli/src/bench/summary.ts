import type { ModelEntry, Tier, Tokens } from '@agent-fusion-router/core'
import { TIERS, emptyTokens, estimateCostUsd, findModel, promptTokens } from '@agent-fusion-router/core'

import type { Arm, RunResult, Task } from './types.ts'

// Three cost figures, kept apart throughout:
// - the plugin's estimate: per request, from the tokens it sees, priced with
//   this project's table;
// - Claude Code's computed session cost (`total_cost_usd`): Claude Code's own
//   figure, the one every comparison uses;
// - the billed cost: the provider's billing, which a run cannot see.

export type ArmSummary = {
  armId: string
  label: string
  runs: number
  validRuns: number
  successes: number
  successRate: number
  /** Claude Code's computed session cost, summed over the valid runs that report one. */
  costUsd: number
  /** Valid runs whose session cost is unknown: left out of `costUsd`, never counted as 0. */
  unknownCostRuns?: number
  /** Session cost ÷ successes: what one finished task cost, failures included. Undefined with no success or an unknown cost. */
  costPerSuccessUsd?: number
  /** The plugin's per-request estimates, summed over the valid runs. */
  pluginEstimateUsd?: number
  /** Claude Code's computed cost − the plugin's estimate. Signed; it mixes unobserved requests with estimation error. */
  differenceUsd?: number
  /** Session cost over the tasks every arm completed: a like-for-like figure. */
  commonTasksCostUsd?: number
  meanWallMs: number
  tokens: Tokens
  meanTurns: number
  permissionDenials: number
  escalations: number
  linesChanged: number
}

export type Cell = {
  taskId: string
  armId: string
  runs: number
  successes: number
  costUsd: number
  unknownCostRuns?: number
  meanWallMs: number
  decidedTiers: Tier[]
}

export type CrossCheckRow = {
  taskId: string
  armId: string
  rep: number
  claudeCostUsd?: number
  pluginCostUsd: number
  /** (plugin − Claude) ÷ Claude, in percent. */
  diffPct?: number
  /** Claude Code's computed cost − the plugin's estimate, signed. */
  differenceUsd?: number
}

export type BenchSummary = {
  arms: ArmSummary[]
  cells: Cell[]
  /** Tasks every arm ran validly and passed on every run. */
  commonTasks?: string[]
  classifier: { scored: number; correct: number; matrix: Record<Tier, Record<Tier, number>> }
  crossCheck: { rows: CrossCheckRow[]; meanAbsDiffPct?: number; maxAbsDiffPct?: number }
  invalid: { taskId: string; armId: string; rep: number; reason: string }[]
}

/** Claude Code's computed session cost; undefined where it reported none. */
export const runCost = (r: RunResult): number | undefined => r.claude?.costUsd

const minus = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input - b.input,
  output: a.output - b.output,
  cacheRead: a.cacheRead - b.cacheRead,
  cacheWrite: a.cacheWrite - b.cacheWrite,
})

const add = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

const isZero = (t: Tokens): boolean => t.input === 0 && t.output === 0 && t.cacheRead === 0 && t.cacheWrite === 0

/**
 * Tokens Claude Code counted outside the conversation, from its own figures
 * alone: per-model totals (`modelUsage`) less the conversation's (`usage`).
 * Observed counts, not costs, and not explained: what those requests were for
 * is not recorded. Undefined where they cannot be told apart.
 */
export const outsideConversationTokens = (r: RunResult): Tokens | undefined => {
  const conversation = r.claude?.conversationTokens
  const conversationModels = r.plugin.models
  if (!r.claude || !conversation || conversationModels.length === 0) return undefined

  const byModel = Object.entries(r.claude.byModel)
  const onConversationModels = byModel
    .filter(([model]) => conversationModels.includes(model))
    .reduce((sum, [, { tokens }]) => add(sum, tokens), emptyTokens())
  const leftover = minus(onConversationModels, conversation)
  if (conversationModels.length > 1 && !isZero(leftover)) return undefined

  return byModel
    .filter(([model]) => !conversationModels.includes(model))
    .reduce((sum, [, { tokens }]) => add(sum, tokens), conversationModels.length === 1 ? leftover : emptyTokens())
}

export type PriceCheck = { checked: number; agree: number; differ: { model: string; claudeUsd: number; tableUsd: number }[] }

/**
 * Whether this project's price table computes what Claude Code computed, model
 * by model, from Claude Code's own token counts. It checks the table against
 * Claude Code's, not against a bill. A long-context price applies per request,
 * so a model whose session total crosses that threshold cannot be checked
 * from totals and is skipped.
 */
export const priceCheck = (r: RunResult, prices: readonly ModelEntry[]): PriceCheck => {
  const result: PriceCheck = { checked: 0, agree: 0, differ: [] }

  for (const [model, { tokens, costUsd }] of Object.entries(r.claude?.byModel ?? {})) {
    const entry = findModel(model, prices)
    const tableUsd = estimateCostUsd(tokens, model, prices)
    const isAmbiguous = entry?.longContext !== undefined && promptTokens(tokens) > entry.longContext.aboveInputTokens
    if (costUsd === undefined || tableUsd === undefined || isAmbiguous) continue

    result.checked += 1
    if (Math.abs(tableUsd - costUsd) < 5e-9) result.agree += 1
    else result.differ.push({ model, claudeUsd: costUsd, tableUsd })
  }

  return result
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

const sumTokens = (list: readonly Tokens[]): Tokens => list.reduce(add, emptyTokens())

/** Sums known costs; `unknown` counts the runs without one, never as 0. */
const sumCosts = (runs: readonly RunResult[]): { usd: number; unknown: number } => ({
  usd: runs.reduce((n, r) => n + (runCost(r) ?? 0), 0),
  unknown: runs.filter(r => runCost(r) === undefined).length,
})

/** Folds run results into the report's figures. Invalid runs are listed, never counted. */
export const summarizeBench = (tasks: readonly Task[], arms: readonly Arm[], unordered: readonly RunResult[]): BenchSummary => {
  // Task order, then arm order, then repetition: the same summary however the runs were executed or loaded.
  const key = (r: RunResult) => [tasks.findIndex(t => t.id === r.taskId), arms.findIndex(a => a.id === r.armId), r.rep]
  const results = [...unordered].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)]
    return (ka[0] ?? 0) - (kb[0] ?? 0) || (ka[1] ?? 0) - (kb[1] ?? 0) || (ka[2] ?? 0) - (kb[2] ?? 0)
  })
  const valid = results.filter(r => r.valid)

  const commonTasks = tasks
    .filter(task =>
      arms.every(arm => {
        const runs = valid.filter(r => r.taskId === task.id && r.armId === arm.id)
        return runs.length > 0 && runs.every(r => r.success)
      }),
    )
    .map(t => t.id)

  const armSummaries = arms.map((arm): ArmSummary => {
    const all = results.filter(r => r.armId === arm.id)
    const runs = valid.filter(r => r.armId === arm.id)
    const successes = runs.filter(r => r.success).length
    const cost = sumCosts(runs)
    const plugin = runs.reduce((n, r) => n + r.plugin.costUsd, 0)
    const common = sumCosts(runs.filter(r => commonTasks.includes(r.taskId)))
    const isKnown = cost.unknown === 0

    return {
      armId: arm.id,
      label: arm.label,
      runs: all.length,
      validRuns: runs.length,
      successes,
      successRate: runs.length === 0 ? 0 : successes / runs.length,
      costUsd: cost.usd,
      ...(isKnown ? {} : { unknownCostRuns: cost.unknown }),
      ...(successes === 0 || !isKnown ? {} : { costPerSuccessUsd: cost.usd / successes }),
      pluginEstimateUsd: plugin,
      ...(isKnown ? { differenceUsd: cost.usd - plugin } : {}),
      ...(common.unknown === 0 && commonTasks.length > 0 ? { commonTasksCostUsd: common.usd } : {}),
      meanWallMs: mean(runs.map(r => r.wallMs)),
      tokens: sumTokens(runs.map(r => r.claude?.tokens ?? r.plugin.tokens)),
      meanTurns: mean(runs.map(r => r.claude?.numTurns ?? 0)),
      permissionDenials: runs.reduce((n, r) => n + (r.claude?.permissionDenials ?? 0), 0),
      escalations: runs.reduce((n, r) => n + r.plugin.escalations, 0),
      linesChanged: runs.reduce((n, r) => n + r.diff.added + r.diff.removed, 0),
    }
  })

  const cells = tasks.flatMap(task =>
    arms.map((arm): Cell => {
      const runs = valid.filter(r => r.taskId === task.id && r.armId === arm.id)
      const cost = sumCosts(runs)

      return {
        taskId: task.id,
        armId: arm.id,
        runs: runs.length,
        successes: runs.filter(r => r.success).length,
        costUsd: cost.usd,
        ...(cost.unknown === 0 ? {} : { unknownCostRuns: cost.unknown }),
        meanWallMs: mean(runs.map(r => r.wallMs)),
        decidedTiers: runs.flatMap(r => (r.plugin.decidedTier ? [r.plugin.decidedTier] : [])),
      }
    }),
  )

  const matrix = Object.fromEntries(
    TIERS.map(e => [e, Object.fromEntries(TIERS.map(d => [d, 0]))]),
  ) as Record<Tier, Record<Tier, number>>
  let scored = 0
  let correct = 0

  for (const r of valid) {
    const expected = tasks.find(t => t.id === r.taskId)?.expectedTier
    const decided = r.plugin.decidedTier
    if (!expected || !decided) continue
    matrix[expected][decided] += 1
    scored += 1
    if (expected === decided) correct += 1
  }

  const rows = valid.map((r): CrossCheckRow => {
    const claudeCostUsd = r.claude?.costUsd
    const diffPct =
      claudeCostUsd === undefined || claudeCostUsd === 0
        ? undefined
        : ((r.plugin.costUsd - claudeCostUsd) / claudeCostUsd) * 100

    return {
      taskId: r.taskId,
      armId: r.armId,
      rep: r.rep,
      claudeCostUsd,
      pluginCostUsd: r.plugin.costUsd,
      diffPct,
      ...(claudeCostUsd === undefined ? {} : { differenceUsd: claudeCostUsd - r.plugin.costUsd }),
    }
  })
  const diffs = rows.flatMap(r => (r.diffPct === undefined ? [] : [Math.abs(r.diffPct)]))

  return {
    arms: armSummaries,
    cells,
    commonTasks,
    classifier: { scored, correct, matrix },
    crossCheck: {
      rows,
      ...(diffs.length === 0 ? {} : { meanAbsDiffPct: mean(diffs), maxAbsDiffPct: Math.max(...diffs) }),
    },
    invalid: results
      .filter(r => !r.valid)
      .map(r => ({ taskId: r.taskId, armId: r.armId, rep: r.rep, reason: r.invalidReason ?? 'invalid' })),
  }
}
