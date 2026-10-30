import type { On, PluginOptions, Register, ToolCallResult } from 'claude-code'

import type { Analysis, Decision, Tier, Tokens, VerificationState } from '@agent-fusion-router/core'
import {
  analyzeTask,
  formatReport,
  isVerificationCommand,
  newVerificationState,
  promptTokens,
  recordVerification,
  route,
  routeSpawn,
  summarize,
} from '@agent-fusion-router/core'

import type { Config } from './config.ts'
import { readConfig } from './config.ts'
import { createLog, parseRecords } from './log.ts'

// The engine reads this module's source and accepts an engine call only
// spelled `$.noun.method(...)` inside a hook body: `$` is never passed to a
// helper. Helpers here are pure; each hook makes its own calls.

const MAIN = 'main'

/** A turn in flight. The prompt is analyzed at once and never kept. */
type TurnState = {
  analysis: Analysis
  decision?: Decision
  decidedAtEscalation: number
  verification: VerificationState
}

/** What a loop (main, or one subagent) carries from one turn to the next. */
type LoopState = {
  currentTurn?: string
  previousTier?: Tier
  lastVerificationFailed?: boolean
  contextTokens?: number
}

type ApiUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const toTokens = (u: ApiUsage): Tokens => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

// A function declaration, not `export const`: the engine accepts `register`
// only as a function declared at the top of the bundled file.
export function register(on: On, options: PluginOptions): void {
  const config = readConfig(options)
  const turns = new Map<string, TurnState>()
  const loops = new Map<string, LoopState>()
  const log = createLog()

  const loopOf = (agentId: string | undefined): LoopState => {
    const key = agentId ?? MAIN
    const loop = loops.get(key) ?? {}
    loops.set(key, loop)

    return loop
  }

  /** Records a verification command's result; answers a status line to show, if any. */
  const onShellCommand = (command: string, agentId: string | undefined, ran: ToolCallResult): string | undefined => {
    if (ran.deny !== undefined || !isVerificationCommand(command)) return undefined

    const turnId = loops.get(agentId ?? MAIN)?.currentTurn
    const turn = turnId === undefined ? undefined : turns.get(turnId)
    if (!turn) return undefined

    const { state, escalate } = recordVerification(turn.verification, ran.isError !== true, config.escalation)
    turn.verification = state

    const shouldShow = escalate && agentId === undefined && config.showStatus && config.policy.mode === 'route'

    return shouldShow ? `router: verification failed ${state.failures}x, moving up a tier` : undefined
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'router',
      description: 'Agent Fusion Router: routing and usage for this session. "/router explain <task>" shows a decision.',
      argumentHint: '[explain <task>]',
    })

    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const task = /^explain\s+([\s\S]+)/i.exec(e.args.trim())?.[1]

    if (task !== undefined) {
      const analysis = analyzeTask(task)
      const decision = route(
        { analysis, currentModel: await $.session.model(), previousTier: loops.get(MAIN)?.previousTier },
        config.policy,
      )

      return { text: describe(analysis, decision, config) }
    }

    const dir = log.dir
    const session = await $.session.id()
    const entries = dir === undefined ? [] : await $.fs.list(dir).catch(() => [])
    const files = entries.filter(f => f.kind === 'file' && f.name.includes(`_${session}_`))
    const texts = await Promise.all(files.map(f => $.fs.read(`${dir}/${f.name}`)))
    const where =
      log.error !== undefined
        ? `Logs are not being written: ${log.error}`
        : `Logs: ${dir ?? 'set at the first turn'}`

    return {
      text: [
        `Mode ${config.policy.mode} · strategy ${config.policy.strategy}`,
        where,
        '',
        formatReport(summarize(parseRecords(texts))),
      ].join('\n'),
    }
  })

  on('turn.start', async ($, e, next) => {
    if (log.dir === undefined) {
      const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
      log.setDir(config.logDir !== '' ? config.logDir : `${home.replace(/[\\/]+$/, '')}/.agent-fusion-router/logs`)
    }

    loopOf(e.agentId).currentTurn = e.turnId
    turns.set(e.turnId, {
      analysis: analyzeTask(e.text),
      decidedAtEscalation: 0,
      verification: newVerificationState(),
    })

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const loop = loopOf(e.agentId)
    const turn = turns.get(e.turnId)
    const isMain = e.agentId === undefined

    // Decide at the turn's first step, and again only after an escalation.
    if (isMain && turn && (turn.decision === undefined || turn.decidedAtEscalation !== turn.verification.escalations)) {
      turn.decision = route(
        {
          analysis: turn.analysis,
          currentModel: e.model,
          currentEffort: e.effort,
          previousTier: loop.previousTier,
          lastVerificationFailed: loop.lastVerificationFailed,
          contextTokens: loop.contextTokens,
          escalations: turn.verification.escalations,
        },
        config.policy,
      )
      turn.decidedAtEscalation = turn.verification.escalations
      if (config.showStatus) $.ui.status(statusText(turn.decision, config))
    }

    const decision = isMain ? turn?.decision : undefined
    const sent = decision?.applied
      ? {
          ...e,
          ...(decision.model === undefined ? {} : { model: decision.model }),
          ...(decision.effort === undefined ? {} : { effort: decision.effort }),
        }
      : e

    const result = yield* next(sent)
    const tokens = result.usage ? toTokens(result.usage) : undefined
    if (tokens) loop.contextTokens = promptTokens(tokens)

    log.add({
      v: 1,
      kind: 'step',
      ts: Date.now(),
      product: 'claude-code',
      session: await $.session.id(),
      agent: e.agentId,
      turn: e.turnId,
      step: e.index,
      mode: config.policy.mode,
      tier: decision?.tier,
      requestedModel: e.model,
      decidedModel: decision?.model,
      decidedEffort: decision?.effort,
      applied: decision?.applied ?? false,
      model: result.usage?.model,
      tokens,
      stop: result.stopReason,
      reasons: decision?.reasons,
    })
    await log.flush(file => $.fs.write(file.path, file.text))

    return result
  })

  // These hooks only watch: on a failure, `.catch` passes the call through,
  // and replays the result where the tool already ran, so it never runs twice.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const status = onShellCommand(e.command, e.agentId, ran)
    if (status !== undefined) $.ui.status(status)

    return ran
  }).catch((_, e, next) => next(e))

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    const status = onShellCommand(e.command, e.agentId, ran)
    if (status !== undefined) $.ui.status(status)

    return ran
  }).catch((_, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const turn = turns.get(e.turnId)
    if (!turn) return result

    turns.delete(e.turnId)

    const loop = loopOf(e.agentId)
    loop.previousTier = turn.decision?.tier ?? loop.previousTier
    loop.lastVerificationFailed = turn.verification.last === 'fail'

    log.add({
      v: 1,
      kind: 'turn',
      ts: Date.now(),
      product: 'claude-code',
      session: await $.session.id(),
      agent: e.agentId,
      turn: e.turnId,
      tier: turn.decision?.tier,
      taskKind: turn.analysis.kind,
      signals: turn.analysis.signals,
      outcome: e.reason,
      durationMs: e.durationMs,
      verifyPasses: turn.verification.passes,
      verifyFailures: turn.verification.failures,
      escalations: turn.verification.escalations,
    })
    await log.flush(file => $.fs.write(file.path, file.text))

    return result
  })

  on('agent.spawn', async ($, e, next) => {
    // A resumed run, a workflow's agent or a fork keeps what it was given.
    const isEligible =
      config.routeSubagents && e.resume === undefined && e.workflow === undefined && e.subagentType !== 'fork'
    if (!isEligible) return next(e)

    const decision = routeSpawn(
      {
        analysis: analyzeTask(`${e.description}\n${e.prompt}`),
        parentModel: e.parentModel,
        requestedModel: e.model,
      },
      config.policy,
    )
    const result = await next(decision.applied && decision.model ? { ...e, model: decision.model } : e)

    log.add({
      v: 1,
      kind: 'spawn',
      ts: Date.now(),
      product: 'claude-code',
      session: await $.session.id(),
      agent: result.agentId,
      subagentType: e.subagentType,
      tier: decision.tier,
      requestedModel: e.model,
      decidedModel: decision.model,
      applied: decision.applied,
      model: result.model,
      reasons: decision.reasons,
    })
    await log.flush(file => $.fs.write(file.path, file.text))

    return result
  }).catch((_, e, next) => next(e))
}

register satisfies Register

const statusText = (d: Decision, config: Config): string => {
  const change = [d.model, d.effort && `effort ${d.effort}`].filter(Boolean).join(', ')

  if (change === '') return `router: ${d.tier}`
  if (config.policy.mode === 'observe') return `router (observe): ${d.tier}, would use ${change}`

  return `router: ${d.tier} → ${change}`
}

const describe = (a: Analysis, d: Decision, config: Config): string =>
  [
    `Kind ${a.kind} · suggested tier ${a.tier} · confidence ${a.confidence}`,
    `Signals: ${a.signals.join(', ') || 'none'}`,
    `Decision: ${statusText(d, config).replace(/^router[^:]*: /, '')}`,
    `Reasons: ${d.reasons.join(', ')}`,
    config.policy.mode === 'observe' ? 'Observe mode: nothing is applied.' : '',
  ]
    .filter(Boolean)
    .join('\n')
