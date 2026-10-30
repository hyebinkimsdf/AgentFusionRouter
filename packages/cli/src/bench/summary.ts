import type { ModelEntry, Tier, Tokens } from '@agent-fusion-router/core'
import { TIERS, emptyTokens, estimateCostUsd } from '@agent-fusion-router/core'

import type { Arm, RunResult, Task } from './types.ts'

export type ArmSummary = {
  armId: string
  label: string
  runs: number
  validRuns: number
  successes: number
  successRate: number
  /** Claude Code's reported cost, summed over valid runs; the plugin's estimate where Claude reported none. */
  costUsd: number
  /** Total cost ÷ successes: what one finished task cost, failures included. Undefined with no success. */
  costPerSuccessUsd?: number
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
}

export type BenchSummary = {
  arms: ArmSummary[]
  cells: Cell[]
  classifier: { scored: number; correct: number; matrix: Record<Tier, Record<Tier, number>> }
  crossCheck: { rows: CrossCheckRow[]; meanAbsDiffPct?: number; maxAbsDiffPct?: number }
  invalid: { taskId: string; armId: string; rep: number; reason: string }[]
}

export const runCost = (r: RunResult): number => r.claude?.costUsd ?? r.plugin.costUsd

const minus = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input - b.input,
  output: a.output - b.output,
  cacheRead: a.cacheRead - b.cacheRead,
  cacheWrite: a.cacheWrite - b.cacheWrite,
})

/**
 * What Claude Code spent outside the conversation (titles, summaries), model
 * by model: a model the conversation never used is all side requests; on the
 * conversation's own model, the side requests are its tokens less the
 * conversation's. Undefined where that cannot be told apart: no conversation
 * figure, a conversation on several models, or a model without a price.
 */
export const outsideConversationUsd = (r: RunResult, prices: readonly ModelEntry[]): number | undefined => {
  const conversation = r.claude?.conversationTokens
  const [conversationModel, ...more] = r.plugin.models
  if (!r.claude || !conversation || conversationModel === undefined || more.length > 0) return undefined

  let total = 0
  for (const [model, { tokens }] of Object.entries(r.claude.byModel)) {
    const cost = estimateCostUsd(model === conversationModel ? minus(tokens, conversation) : tokens, model, prices)
    if (cost === undefined) return undefined
    total += cost
  }

  return total
}

/** Plugin estimate + outside the conversation − Claude Code's total: 0 when every cent is accounted for. */
export const unaccountedUsd = (r: RunResult, prices: readonly ModelEntry[]): number | undefined => {
  const outside = outsideConversationUsd(r, prices)
  const total = r.claude?.costUsd

  return outside === undefined || total === undefined ? undefined : r.plugin.costUsd + outside - total
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

const sumTokens = (list: readonly Tokens[]): Tokens =>
  list.reduce(
    (a, t) => ({
      input: a.input + t.input,
      output: a.output + t.output,
      cacheRead: a.cacheRead + t.cacheRead,
      cacheWrite: a.cacheWrite + t.cacheWrite,
    }),
    emptyTokens(),
  )

/** Folds run results into the report's figures. Invalid runs are listed, never counted. */
export const summarizeBench = (tasks: readonly Task[], arms: readonly Arm[], unordered: readonly RunResult[]): BenchSummary => {
  // Task order, then arm order, then repetition: the same summary however the runs were executed or loaded.
  const key = (r: RunResult) => [tasks.findIndex(t => t.id === r.taskId), arms.findIndex(a => a.id === r.armId), r.rep]
  const results = [...unordered].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)]
    return (ka[0] ?? 0) - (kb[0] ?? 0) || (ka[1] ?? 0) - (kb[1] ?? 0) || (ka[2] ?? 0) - (kb[2] ?? 0)
  })
  const valid = results.filter(r => r.valid)

  const armSummaries = arms.map((arm): ArmSummary => {
    const all = results.filter(r => r.armId === arm.id)
    const runs = valid.filter(r => r.armId === arm.id)
    const successes = runs.filter(r => r.success).length
    const costUsd = runs.reduce((n, r) => n + runCost(r), 0)

    return {
      armId: arm.id,
      label: arm.label,
      runs: all.length,
      validRuns: runs.length,
      successes,
      successRate: runs.length === 0 ? 0 : successes / runs.length,
      costUsd,
      ...(successes === 0 ? {} : { costPerSuccessUsd: costUsd / successes }),
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

      return {
        taskId: task.id,
        armId: arm.id,
        runs: runs.length,
        successes: runs.filter(r => r.success).length,
        costUsd: runs.reduce((n, r) => n + runCost(r), 0),
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

    return { taskId: r.taskId, armId: r.armId, rep: r.rep, claudeCostUsd, pluginCostUsd: r.plugin.costUsd, diffPct }
  })
  const diffs = rows.flatMap(r => (r.diffPct === undefined ? [] : [Math.abs(r.diffPct)]))

  return {
    arms: armSummaries,
    cells,
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
