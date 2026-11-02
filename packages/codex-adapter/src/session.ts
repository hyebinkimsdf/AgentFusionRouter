// A runner-started Codex thread: each turn is decided by `decideTurn`, sent
// with `turn/start`, and logged in the plugin's record format.
//
// Usage is read from `thread/tokenUsage/updated`. On Codex 0.164 each model
// request sends one, `last` that request's usage and `total` the thread's;
// both matched the session's rollout records exactly. A notification whose
// total did not grow repeats an earlier one and is skipped. Codex's own
// rollout file stays the source of the usage ledger: these records say what
// the router chose, beside the tokens each request reported.

import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Effort, EscalationPolicy, RoutePolicy, StepRecord, TurnRecord, UsageRecord, VerificationState } from '@agent-fusion-router/core'
import { DEFAULT_ESCALATION, isVerificationCommand, newVerificationState, recordVerification } from '@agent-fusion-router/core'

import type { AppServer, Notification } from './appserver.ts'
import type { CodexTokens } from './ledger.ts'
import type { ModelInfo, Setting, ThreadState, TurnPlan } from './runner.ts'
import { afterTurn, decideTurn, modelsFromList } from './runner.ts'
import { toCoreTokens } from './savings.ts'

export type SessionEvent =
  | { type: 'text'; delta: string }
  | { type: 'command'; command: string; exitCode: number | null; verification: boolean }
  | { type: 'rerouted'; from: string; to: string }

export type SessionOptions = {
  cwd: string
  /** The baseline model and effort; absent, Codex's configured ones. */
  model?: string
  effort?: string
  policy: RoutePolicy
  escalation?: EscalationPolicy
  log: (record: UsageRecord) => void | Promise<void>
  onEvent?: (event: SessionEvent) => void
}

/** A rate-limit window as Codex reports it: the share of the plan's limit used. */
export type LimitWindow = { usedPercent: number; windowDurationMins?: number; resetsAt?: number }

export type SessionInfo = {
  threadId: string
  /** How the account signs in: `chatgpt` draws on plan limits; `apiKey` is billed per token. */
  account?: { type: string; planType?: string }
  models: ModelInfo[]
  baseline: Setting
  limits?: { primary?: LimitWindow; secondary?: LimitWindow }
}

export type TurnResult = {
  turnId: string
  status: string
  plan: TurnPlan
  /** What the turn ran on: the setting sent or inherited, and a model Codex rerouted to. */
  ran: Setting
  /** Each model request's usage, in order. */
  requests: CodexTokens[]
  verification: VerificationState
  durationMs?: number
}

const VERSION = '0.1.0'
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

const tokensOf = (b: Record<string, unknown> | undefined): CodexTokens => {
  const n = (k: string): number => (typeof b?.[k] === 'number' ? (b[k] as number) : 0)
  return { input: n('inputTokens'), cachedInput: n('cachedInputTokens'), cacheWriteInput: n('cacheWriteInputTokens'), output: n('outputTokens'), reasoningOutput: n('reasoningOutputTokens'), total: n('totalTokens') }
}

const limitOf = (w: unknown): LimitWindow | undefined => {
  const r = w as Record<string, unknown> | undefined
  return typeof r?.usedPercent !== 'number'
    ? undefined
    : { usedPercent: r.usedPercent, ...(typeof r.windowDurationMins === 'number' ? { windowDurationMins: r.windowDurationMins } : {}), ...(typeof r.resetsAt === 'number' ? { resetsAt: r.resetsAt } : {}) }
}

const OUTCOMES: Record<string, TurnRecord['outcome']> = { completed: 'answer', interrupted: 'aborted', failed: 'error' }

export const openSession = async (server: AppServer, opts: SessionOptions) => {
  await server.request('initialize', { clientInfo: { name: 'agent_fusion_router', title: 'Agent Fusion Router', version: VERSION } })
  server.notify('initialized')

  const account = (await server.request<{ account?: { type?: string; planType?: string } }>('account/read', {}).catch(() => undefined))?.account
  const models = modelsFromList(await server.request('model/list', {}).catch(() => undefined))
  const rate = (await server.request<{ rateLimits?: Record<string, unknown> }>('account/rateLimits/read', {}).catch(() => undefined))?.rateLimits
  const started = await server.request<{ thread: { id: string }; model: string; reasoningEffort?: string | null }>('thread/start', {
    cwd: opts.cwd,
    ...(opts.model === undefined ? {} : { model: opts.model }),
    ...(opts.effort === undefined ? {} : { config: { model_reasoning_effort: opts.effort } }),
  })

  const threadId = started.thread.id
  const baseline: Setting = { model: started.model, ...(typeof started.reasoningEffort === 'string' ? { effort: started.reasoningEffort } : {}) }
  const info: SessionInfo = {
    threadId,
    ...(typeof account?.type === 'string' ? { account: { type: account.type, ...(typeof account.planType === 'string' ? { planType: account.planType } : {}) } } : {}),
    models,
    baseline,
    ...(rate === undefined ? {} : { limits: { primary: limitOf(rate.primary), secondary: limitOf(rate.secondary) } }),
  }
  server.listen(n => {
    const limits = (n.params?.rateLimits ?? undefined) as Record<string, unknown> | undefined
    if (n.method === 'account/rateLimits/updated' && limits !== undefined) info.limits = { primary: limitOf(limits.primary), secondary: limitOf(limits.secondary) }
  })

  let state: ThreadState = { baseline, current: baseline, lastVerificationFailed: false, contextTokens: 0 }
  let active: string | undefined

  const runTurn = async (prompt: string): Promise<TurnResult> => {
    const plan = decideTurn(state, prompt, opts.policy, models)
    const ran: Setting = { ...state.current, ...plan.send }
    const requests: CodexTokens[] = []
    let lastTotal = -1
    let verification = newVerificationState()
    let turnId: string | undefined
    const early: Notification[] = []
    let finish: (turn: Record<string, unknown>) => void = () => {}
    const finished = new Promise<Record<string, unknown>>(resolve => {
      finish = resolve
    })

    const handle = (n: Notification): void => {
      const p = n.params ?? {}
      const item = p.item as Record<string, unknown> | undefined
      if (n.method === 'turn/completed' && (p.turn as { id?: string } | undefined)?.id === turnId) finish(p.turn as Record<string, unknown>)
      if (p.turnId !== turnId) return

      if (n.method === 'thread/tokenUsage/updated') {
        const usage = p.tokenUsage as Record<string, Record<string, unknown>> | undefined
        const total = tokensOf(usage?.total).total
        if (total <= lastTotal) return
        lastTotal = total
        requests.push(tokensOf(usage?.last))
      } else if (n.method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
        opts.onEvent?.({ type: 'text', delta: p.delta })
      } else if (n.method === 'item/completed' && item?.type === 'commandExecution' && typeof item.command === 'string') {
        const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
        const verifies = isVerificationCommand(item.command) && exitCode !== null
        if (verifies) verification = recordVerification(verification, exitCode === 0, opts.escalation ?? DEFAULT_ESCALATION).state
        opts.onEvent?.({ type: 'command', command: item.command, exitCode, verification: verifies })
      } else if (n.method === 'model/rerouted' && typeof p.toModel === 'string') {
        opts.onEvent?.({ type: 'rerouted', from: String(p.fromModel), to: p.toModel })
        ran.model = p.toModel
      }
    }
    // Notifications can arrive before turn/start answers with the turn's id.
    const unlisten = server.listen(n => {
      if (n.params?.threadId !== threadId) return
      if (turnId === undefined) early.push(n)
      else handle(n)
    })

    try {
      const response = await server.request<{ turn: { id: string } }>('turn/start', { threadId, input: [{ type: 'text', text: prompt }], ...plan.send })
      turnId = response.turn.id
      active = turnId
      for (const n of early.splice(0)) handle(n)
      const turn = await finished

      const status = typeof turn.status === 'string' ? turn.status : 'unknown'
      const durationMs = typeof turn.durationMs === 'number' ? turn.durationMs : undefined
      await writeRecords(plan, ran, turnId, requests, verification, status, durationMs)
      state = afterTurn(state, plan, { contextTokens: requests.at(-1)?.input, ...(verification.last === undefined ? {} : { lastVerification: verification.last }) })

      return { turnId, status, plan, ran, requests, verification, ...(durationMs === undefined ? {} : { durationMs }) }
    } finally {
      unlisten()
      active = undefined
    }
  }

  const writeRecords = async (plan: TurnPlan, ran: Setting, turn: string, requests: readonly CodexTokens[], verification: VerificationState, status: string, durationMs: number | undefined) => {
    const ts = Date.now()
    // Applied: the turn ran on the router's choice rather than the person's, whether sent now or inherited.
    const applied = opts.policy.mode === 'route' && (ran.model !== baseline.model || ran.effort !== baseline.effort)
    const steps = requests.map(
      (tokens, step): StepRecord => ({
        v: 1,
        kind: 'step',
        ts,
        product: 'codex',
        session: threadId,
        turn,
        step,
        mode: opts.policy.mode,
        tier: plan.tier,
        requestedModel: baseline.model,
        ...(plan.target.model === baseline.model ? {} : { decidedModel: plan.target.model }),
        ...(plan.target.effort === baseline.effort || !EFFORTS.includes(plan.target.effort ?? '') ? {} : { decidedEffort: plan.target.effort as Effort }),
        applied,
        ...(baseline.effort === undefined ? {} : { requestedEffort: baseline.effort }),
        ...(ran.effort === undefined ? {} : { effort: ran.effort }),
        model: ran.model,
        tokens: toCoreTokens(tokens),
        reasons: plan.reasons,
      }),
    )
    const turnRecord: TurnRecord = {
      v: 1,
      kind: 'turn',
      ts,
      product: 'codex',
      session: threadId,
      turn,
      tier: plan.tier,
      taskKind: plan.analysis.kind,
      signals: plan.analysis.signals,
      outcome: OUTCOMES[status] ?? 'error',
      durationMs: durationMs ?? 0,
      verifyPasses: verification.passes,
      verifyFailures: verification.failures,
      escalations: 0,
    }
    for (const r of [...steps, turnRecord]) await opts.log(r)
  }

  return {
    info,
    runTurn,
    /** Stops the running turn, if any. */
    interrupt: async (): Promise<boolean> => {
      if (active === undefined) return false
      await server.request('turn/interrupt', { threadId, turnId: active }).catch(() => undefined)
      return true
    },
    state: (): ThreadState => state,
  }
}

export type CodexSession = Awaited<ReturnType<typeof openSession>>

/**
 * Where the runner's records go: a folder of their own, so the Claude Code
 * report never counts Codex requests, and Codex's tokens keep one source,
 * its rollout files.
 */
export const defaultRunLogDir = (): string => join(homedir(), '.agent-fusion-router', 'codex-logs')

/** Appends records to `<dir>/<day>_<thread>_<pid>.jsonl`, one file per thread and process. */
export const runLog = (dir: string) => {
  let made = false
  return async (record: UsageRecord): Promise<void> => {
    if (!made) await mkdir(dir, { recursive: true })
    made = true
    await appendFile(join(dir, `${new Date(record.ts).toISOString().slice(0, 10)}_${record.session}_${process.pid}.jsonl`), `${JSON.stringify(record)}\n`)
  }
}
