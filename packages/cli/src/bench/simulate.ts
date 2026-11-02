import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Effort, RoutePolicy, StepRecord, Tier, TierTarget, Tokens, TurnRecord } from '@agent-fusion-router/core'
import { DEFAULT_POLICY, TIERS, analyzeTask, capabilityRank, estimateCostUsd, findModel, promptTokens, route, tierRank } from '@agent-fusion-router/core'

import type { Arm, Task } from './types.ts'
import { overlay, referenceAnswer } from './workspace.ts'

// A stand-in for `claude -p` that calls no model, to exercise the runner,
// the report and the evidence files end to end. Its numbers are invented:
// every file it writes says `simulated`, and so does the report.

/** Deterministic noise in [0.85, 1.15) from a string, so a simulated run repeats exactly. */
const jitter = (seed: string): number => {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)

  return 0.85 + ((h >>> 0) % 3000) / 10000
}

const STEPS = { light: 3, standard: 6, heavy: 10 } as const

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** The arm's plugin settings as the plugin reads them: strategy, the standard model, and each tier's effort. */
const policyOf = (arm: Arm): RoutePolicy => {
  const option = (name: string): unknown => arm.plugin[name]
  const tier = (t: Tier): TierTarget => {
    const model = t === 'standard' && typeof option('standardModel') === 'string' && option('standardModel') !== '' ? String(option('standardModel')) : DEFAULT_POLICY.tiers[t].model
    const effort = EFFORTS.includes(option(`${t}Effort`) as Effort) ? (option(`${t}Effort`) as Effort) : DEFAULT_POLICY.tiers[t].effort

    return { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }
  }

  return {
    ...DEFAULT_POLICY,
    mode: option('mode') === 'route' ? 'route' : 'observe',
    strategy: option('strategy') === 'effort' ? 'effort' : 'model',
    tiers: Object.fromEntries(TIERS.map(t => [t, tier(t)])) as Record<Tier, TierTarget>,
  }
}

const sum = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

export const simulateAgent = async (input: {
  task: Task
  arm: Arm
  rep: number
  workspace: string
  solutionsDir: string
  logDir: string
}): Promise<{ stdout: string; wallMs: number }> => {
  const { task, arm, rep } = input
  const session = `sim-${task.id}-${arm.id}-${rep}`
  // The account's default is unknown here: a simulated run stands in Opus for
  // it. opusplan uses Opus only in plan mode, which a headless run never enters.
  const sessionModel = arm.model === 'opusplan' ? 'sonnet' : (arm.model ?? 'opus')
  const requested = findModel(sessionModel)?.id ?? sessionModel
  const sessionEffort: Effort = 'medium'
  const policy = policyOf(arm)
  const turns = [{ prompt: task.prompt, expectedTier: task.expectedTier }, ...(task.followUps ?? [])]

  const ts = Date.UTC(2026, 9, 30, 9, 0, 0)
  const records: (StepRecord | TurnRecord)[] = []
  const byModel = new Map<string, Tokens>()
  let succeeds = true
  let previousTier: Tier | undefined
  let previous: { model: string; effort: Effort } | undefined
  let context = 0
  let clock = 0
  let steps = 0

  for (const [t, turn] of turns.entries()) {
    const analysis = analyzeTask(turn.prompt)
    // As the plugin does: every turn is decided against the session's own model and effort.
    const decision = route({ analysis, currentModel: requested, currentEffort: sessionEffort, previousTier, contextTokens: context }, policy)
    const model = decision.applied && decision.model ? (findModel(decision.model)?.id ?? decision.model) : requested
    const effort = decision.applied && decision.effort ? decision.effort : sessionEffort

    // The one rule of the simulation: a model below a turn's tier fails the task.
    const tierOfModel = (capabilityRank(model) ?? 1) === 0 ? 'light' : (capabilityRank(model) ?? 1) === 1 ? 'standard' : 'heavy'
    succeeds &&= tierRank(tierOfModel) >= tierRank(turn.expectedTier)
    // A switch reads the conversation so far into a cold cache.
    const switched = previous !== undefined && (previous.model !== model || previous.effort !== effort)

    const count = STEPS[turn.expectedTier]
    for (let i = 0; i < count; i += 1) {
      const k = jitter(`${session}-${t}-${i}`)
      const first = i === 0
      const tokens: Tokens = {
        input: Math.round(400 * k),
        output: Math.round((300 + 150 * i) * k),
        cacheRead: first && switched ? 0 : Math.round((14_000 + context + 2_500 * i) * k),
        cacheWrite: first ? Math.round((t === 0 ? 14_000 : switched ? context : 1_800) * k) : Math.round(1_800 * k),
      }
      byModel.set(model, sum(byModel.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tokens))
      records.push({
        v: 1,
        kind: 'step',
        ts: ts + clock,
        product: 'claude-code',
        session,
        turn: `turn-${t + 1}`,
        step: i,
        mode: policy.mode,
        tier: decision.tier,
        requestedModel: requested,
        decidedModel: decision.model,
        decidedEffort: decision.effort,
        applied: decision.applied,
        requestedEffort: sessionEffort,
        effort,
        model,
        tokens,
        stop: i === count - 1 ? 'end_turn' : 'tool_use',
        reasons: decision.reasons,
      })
      clock += Math.round(4000 * k)
      if (i === count - 1) context = promptTokens(tokens)
    }
    steps += count

    records.push({
      v: 1,
      kind: 'turn',
      ts: ts + clock,
      product: 'claude-code',
      session,
      turn: `turn-${t + 1}`,
      tier: decision.tier,
      taskKind: task.kind,
      signals: analysis.signals,
      outcome: 'answer',
      durationMs: Math.round(count * 4000 * jitter(`${session}-${t}-time`)),
      verifyPasses: succeeds ? 1 : 0,
      verifyFailures: succeeds ? 0 : 2,
      escalations: 0,
    })
    previousTier = decision.tier
    previous = { model, effort }
  }

  if (succeeds) {
    await overlay(join(input.solutionsDir, task.id), input.workspace)
    await rm(join(input.workspace, 'answer.txt'), { force: true })
  }
  const answer = succeeds ? await referenceAnswer(input.solutionsDir, task) : 'I could not finish this.'

  await mkdir(input.logDir, { recursive: true })
  await writeFile(join(input.logDir, `2026-10-30_${session}_sim-0.jsonl`), `${records.map(r => JSON.stringify(r)).join('\n')}\n`)

  const wallMs = Math.round(clock * jitter(`${session}-time`))
  const modelUsage = Object.fromEntries(
    [...byModel].map(([model, t]) => [
      model,
      { inputTokens: t.input, outputTokens: t.output, cacheReadInputTokens: t.cacheRead, cacheCreationInputTokens: t.cacheWrite, costUSD: estimateCostUsd(t, model) ?? 0 },
    ]),
  )
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'success',
    simulated: true,
    is_error: false,
    duration_ms: wallMs,
    num_turns: steps,
    result: answer,
    session_id: session,
    total_cost_usd: Object.values(modelUsage).reduce((n, m) => n + m.costUSD, 0),
    permission_denials: [],
    modelUsage,
  })

  return { stdout: `${stdout}\n`, wallMs }
}
