import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { StepRecord, Tokens, TurnRecord } from '@agent-fusion-router/core'
import { DEFAULT_POLICY, analyzeTask, capabilityRank, estimateCostUsd, findModel, route, tierRank } from '@agent-fusion-router/core'

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
  const requested = findModel(arm.model)?.id ?? arm.model
  const policy = {
    ...DEFAULT_POLICY,
    mode: arm.plugin.mode === 'route' ? ('route' as const) : ('observe' as const),
    tiers: {
      ...DEFAULT_POLICY.tiers,
      ...(typeof arm.plugin.standardModel === 'string' && arm.plugin.standardModel !== ''
        ? { standard: { model: arm.plugin.standardModel } }
        : {}),
    },
  }
  const decision = route({ analysis: analyzeTask(task.prompt), currentModel: requested, currentEffort: 'medium' }, policy)
  const model = decision.applied && decision.model ? (findModel(decision.model)?.id ?? decision.model) : requested

  // The one rule of the simulation: a model below the task's tier fails it.
  const tierOfModel = (capabilityRank(model) ?? 1) === 0 ? 'light' : (capabilityRank(model) ?? 1) === 1 ? 'standard' : 'heavy'
  const succeeds = tierRank(tierOfModel) >= tierRank(task.expectedTier)

  if (succeeds) {
    await overlay(join(input.solutionsDir, task.id), input.workspace)
    await rm(join(input.workspace, 'answer.txt'), { force: true })
  }
  const answer = succeeds ? await referenceAnswer(input.solutionsDir, task) : 'I could not finish this.'

  const steps = STEPS[task.expectedTier]
  const ts = Date.UTC(2026, 9, 30, 9, 0, 0)
  const records: (StepRecord | TurnRecord)[] = []
  let total: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  for (let i = 0; i < steps; i += 1) {
    const k = jitter(`${session}-${i}`)
    const tokens: Tokens = {
      input: Math.round(400 * k),
      output: Math.round((300 + 150 * i) * k),
      cacheRead: Math.round((14_000 + 2_500 * i) * k),
      cacheWrite: Math.round((i === 0 ? 14_000 : 1_800) * k),
    }
    total = {
      input: total.input + tokens.input,
      output: total.output + tokens.output,
      cacheRead: total.cacheRead + tokens.cacheRead,
      cacheWrite: total.cacheWrite + tokens.cacheWrite,
    }
    records.push({
      v: 1,
      kind: 'step',
      ts: ts + i * 4000,
      product: 'claude-code',
      session,
      turn: 'turn-1',
      step: i,
      mode: policy.mode,
      tier: decision.tier,
      requestedModel: requested,
      decidedModel: decision.model,
      decidedEffort: decision.effort,
      applied: decision.applied,
      model,
      tokens,
      stop: i === steps - 1 ? 'end_turn' : 'tool_use',
      reasons: decision.reasons,
    })
  }

  const wallMs = Math.round(steps * 4000 * jitter(`${session}-time`))
  records.push({
    v: 1,
    kind: 'turn',
    ts: ts + wallMs,
    product: 'claude-code',
    session,
    turn: 'turn-1',
    tier: decision.tier,
    taskKind: task.kind,
    signals: analyzeTask(task.prompt).signals,
    outcome: 'answer',
    durationMs: wallMs,
    verifyPasses: succeeds ? 1 : 0,
    verifyFailures: succeeds ? 0 : 2,
    escalations: 0,
  })

  await mkdir(input.logDir, { recursive: true })
  await writeFile(join(input.logDir, `2026-10-30_${session}_sim-0.jsonl`), `${records.map(r => JSON.stringify(r)).join('\n')}\n`)

  const costUsd = estimateCostUsd(total, model) ?? 0
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'success',
    simulated: true,
    is_error: false,
    duration_ms: wallMs,
    num_turns: steps,
    result: answer,
    session_id: session,
    total_cost_usd: costUsd,
    permission_denials: [],
    modelUsage: {
      [model]: {
        inputTokens: total.input,
        outputTokens: total.output,
        cacheReadInputTokens: total.cacheRead,
        cacheCreationInputTokens: total.cacheWrite,
        costUSD: costUsd,
      },
    },
  })

  return { stdout: `${stdout}\n`, wallMs }
}
