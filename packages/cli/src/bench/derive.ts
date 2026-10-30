import type { Tokens, UsageRecord } from '@agent-fusion-router/core'
import { emptyTokens, estimateCostUsd } from '@agent-fusion-router/core'

import type { CheckOutcome, ClaudeFacts, PluginFacts, RunMeta, RunResult } from './types.ts'

// Everything here is a pure function of the raw files a run leaves behind,
// so `bench verify` can recompute every number from them.

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const add = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

/** The result object of `claude -p --output-format json`: the last JSON line printed. */
export const parseClaudeOutput = (stdout: string): ClaudeFacts | undefined => {
  const line = stdout
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('{'))
    .at(-1)
  if (line === undefined) return undefined

  let json: Record<string, unknown>
  try {
    json = JSON.parse(line) as Record<string, unknown>
  } catch {
    return undefined
  }

  const byModel: ClaudeFacts['byModel'] = {}
  let tokens = emptyTokens()

  for (const [model, raw] of Object.entries((json.modelUsage ?? {}) as Record<string, Record<string, unknown>>)) {
    const t: Tokens = {
      input: num(raw.inputTokens),
      output: num(raw.outputTokens),
      cacheRead: num(raw.cacheReadInputTokens),
      cacheWrite: num(raw.cacheCreationInputTokens),
    }
    byModel[model] = { tokens: t, costUsd: typeof raw.costUSD === 'number' ? raw.costUSD : undefined }
    tokens = add(tokens, t)
  }

  return {
    isError: json.is_error === true,
    costUsd: typeof json.total_cost_usd === 'number' ? json.total_cost_usd : undefined,
    durationMs: typeof json.duration_ms === 'number' ? json.duration_ms : undefined,
    numTurns: typeof json.num_turns === 'number' ? json.num_turns : undefined,
    permissionDenials: Array.isArray(json.permission_denials) ? json.permission_denials.length : 0,
    tokens,
    byModel,
  }
}

/** The final answer text of a `claude -p --output-format json` run. */
export const claudeAnswer = (stdout: string): string => {
  const line = stdout
    .split('\n')
    .filter(l => l.trim().startsWith('{'))
    .at(-1)
  try {
    const result = (JSON.parse(line ?? '{}') as { result?: unknown }).result
    return typeof result === 'string' ? result : ''
  } catch {
    return ''
  }
}

export const pluginFacts = (records: readonly UsageRecord[]): PluginFacts => {
  let tokens = emptyTokens()
  let costUsd = 0
  let requests = 0
  let routedRequests = 0
  let escalations = 0
  let decidedTier: PluginFacts['decidedTier']
  const models = new Set<string>()

  for (const r of records) {
    if (r.kind === 'turn') {
      escalations += r.escalations
      continue
    }
    if (r.kind !== 'step') continue

    requests += 1
    if (r.applied) routedRequests += 1
    if (decidedTier === undefined && r.agent === undefined) decidedTier = r.tier
    if (r.model) models.add(r.model)
    if (r.tokens) {
      tokens = add(tokens, r.tokens)
      costUsd += estimateCostUsd(r.tokens, r.model ?? r.requestedModel) ?? 0
    }
  }

  return { loaded: requests > 0, requests, tokens, costUsd, decidedTier, routedRequests, escalations, models: [...models].sort() }
}

/** `git diff --numstat` output → files changed and lines added and removed. */
export const diffStats = (numstat: string): RunResult['diff'] => {
  const rows = numstat
    .split('\n')
    .map(l => l.split('\t'))
    .filter(cols => cols.length >= 3)

  return {
    files: rows.length,
    added: rows.reduce((n, [a]) => n + (Number(a) || 0), 0),
    removed: rows.reduce((n, [, r]) => n + (Number(r) || 0), 0),
  }
}

export type RawRun = {
  meta: RunMeta
  claudeStdout: string
  records: readonly UsageRecord[]
  check: CheckOutcome
  numstat: string
  /** The arm asked the plugin to route: no plugin records then means no routing. */
  needsPlugin: boolean
}

export const deriveResult = (raw: RawRun): RunResult => {
  const claude = parseClaudeOutput(raw.claudeStdout)
  const plugin = pluginFacts(raw.records)
  const success = raw.check.testsPassed && raw.check.answerOk !== false

  const invalidReason = raw.meta.timedOut
    ? 'timed out'
    : claude === undefined
      ? 'Claude Code printed no result'
      : raw.needsPlugin && !plugin.loaded
        ? 'the plugin recorded nothing, so routing did not run'
        : undefined

  return {
    taskId: raw.meta.taskId,
    armId: raw.meta.armId,
    rep: raw.meta.rep,
    valid: invalidReason === undefined,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    success,
    check: raw.check,
    wallMs: raw.meta.wallMs,
    claude,
    plugin,
    diff: diffStats(raw.numstat),
  }
}
