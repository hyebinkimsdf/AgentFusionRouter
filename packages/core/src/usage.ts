import type { ModelEntry } from './catalog.ts'
import { PRICES_AS_OF, findModel } from './catalog.ts'
import type { Effort, Mode, Product, Tier } from './types.ts'

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

type RecordBase = {
  v: 1
  ts: number
  product: Product
  session: string
  /** The subagent's id; absent on the main loop. */
  agent?: string
}

/** One model request, as the API reported it. */
export type StepRecord = RecordBase & {
  kind: 'step'
  turn: string
  step: number
  mode: Mode
  tier?: Tier
  /** What the engine was about to send before the router. */
  requestedModel: string
  /** The router's choice, applied or not (observe mode). */
  decidedModel?: string
  decidedEffort?: Effort
  applied: boolean
  /** The model that answered, as the API names it. */
  model?: string
  tokens?: Tokens
  stop?: string | null
  reasons?: string[]
}

/** One turn: a prompt and everything the agent did for it. */
export type TurnRecord = RecordBase & {
  kind: 'turn'
  turn: string
  tier?: Tier
  taskKind?: string
  signals?: string[]
  outcome: 'answer' | 'aborted' | 'refusal' | 'error'
  durationMs: number
  verifyPasses: number
  verifyFailures: number
  escalations: number
}

/** One subagent start. */
export type SpawnRecord = RecordBase & {
  kind: 'spawn'
  subagentType: string
  tier: Tier
  requestedModel?: string
  decidedModel?: string
  applied: boolean
  /** What it runs on, as the engine resolved it; absent when it did not start. */
  model?: string
  reasons: string[]
}

export type UsageRecord = StepRecord | TurnRecord | SpawnRecord

export const emptyTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

/** Everything the request sent, cached or not: the context's size. */
export const promptTokens = (t: Tokens): number => t.input + t.cacheRead + t.cacheWrite

/** List-price estimate in USD, or undefined for a model the catalog lacks. */
export const estimateCostUsd = (tokens: Tokens, model: string, models?: readonly ModelEntry[]): number | undefined => {
  const entry = findModel(model, models)
  if (!entry) return undefined

  const long = entry.longContext
  const p = long && promptTokens(tokens) > long.aboveInputTokens ? long.price : entry.price

  return (
    (tokens.input * p.input +
      tokens.output * p.output +
      tokens.cacheRead * p.cacheRead +
      tokens.cacheWrite * p.cacheWrite) /
    1_000_000
  )
}

export type ModelRow = { model: string; requests: number; tokens: Tokens; costUsd?: number }

export type Summary = {
  from?: number
  to?: number
  sessions: number
  requests: number
  byModel: ModelRow[]
  turns: number
  turnsByTier: Partial<Record<Tier, number>>
  turnsByOutcome: Record<string, number>
  escalatedTurns: number
  routedRequests: number
  /** Observe mode: requests the router would have changed. */
  wouldRouteRequests: number
  spawns: number
  routedSpawns: number
  costUsd: number
  /** The same tokens priced at the model asked for before routing. */
  unroutedCostUsd: number
  /** Observe mode: the same tokens priced at the router's choice. */
  potentialCostUsd: number
  unpricedModels: string[]
}

/** Folds records into the report's figures. Token totals come from steps only. */
export const summarize = (records: readonly UsageRecord[]): Summary => {
  const sessions = new Set<string>()
  const models = new Map<string, ModelRow>()
  const unpriced = new Set<string>()
  const s: Summary = {
    sessions: 0,
    requests: 0,
    byModel: [],
    turns: 0,
    turnsByTier: {},
    turnsByOutcome: {},
    escalatedTurns: 0,
    routedRequests: 0,
    wouldRouteRequests: 0,
    spawns: 0,
    routedSpawns: 0,
    costUsd: 0,
    unroutedCostUsd: 0,
    potentialCostUsd: 0,
    unpricedModels: [],
  }

  for (const r of records) {
    sessions.add(r.session)
    s.from = Math.min(s.from ?? r.ts, r.ts)
    s.to = Math.max(s.to ?? r.ts, r.ts)

    if (r.kind === 'turn') {
      s.turns += 1
      if (r.tier) s.turnsByTier[r.tier] = (s.turnsByTier[r.tier] ?? 0) + 1
      s.turnsByOutcome[r.outcome] = (s.turnsByOutcome[r.outcome] ?? 0) + 1
      if (r.escalations > 0) s.escalatedTurns += 1
      continue
    }

    if (r.kind === 'spawn') {
      s.spawns += 1
      if (r.applied) s.routedSpawns += 1
      continue
    }

    s.requests += 1
    if (r.applied) s.routedRequests += 1
    const wouldRoute = !r.applied && (r.decidedModel !== undefined || r.decidedEffort !== undefined)
    if (wouldRoute) s.wouldRouteRequests += 1

    if (!r.tokens) continue

    const model = r.model ?? r.requestedModel
    const row = models.get(model) ?? { model, requests: 0, tokens: emptyTokens(), costUsd: 0 }
    const cost = estimateCostUsd(r.tokens, model)

    row.requests += 1
    row.tokens = addTokens(row.tokens, r.tokens)
    if (cost === undefined) {
      unpriced.add(model)
      row.costUsd = undefined
    } else if (row.costUsd !== undefined) {
      row.costUsd += cost
    }
    models.set(model, row)

    const actual = cost ?? 0
    s.costUsd += actual
    s.unroutedCostUsd += r.applied ? (estimateCostUsd(r.tokens, r.requestedModel) ?? actual) : actual
    s.potentialCostUsd +=
      wouldRoute && r.decidedModel ? (estimateCostUsd(r.tokens, r.decidedModel) ?? actual) : actual
  }

  s.sessions = sessions.size
  s.byModel = [...models.values()].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))
  s.unpricedModels = [...unpriced]

  return s
}

const compact = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`

const day = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

const pad = (cells: readonly string[], widths: readonly number[]): string =>
  cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join('  ')

const counts = (record: Partial<Record<string, number>>): string =>
  Object.entries(record)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ') || 'none'

/** The report as plain text for a terminal. */
export const formatReport = (s: Summary): string => {
  if (s.requests === 0 && s.turns === 0) return 'No usage recorded yet.'

  const header = ['Model', 'Requests', 'Input', 'Output', 'Cache rd', 'Cache wr', 'Est. USD']
  const rows = s.byModel.map(r => [
    r.model,
    `${r.requests}`,
    compact(r.tokens.input),
    compact(r.tokens.output),
    compact(r.tokens.cacheRead),
    compact(r.tokens.cacheWrite),
    r.costUsd === undefined ? 'n/a' : usd(r.costUsd),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)))
  const period = s.from === undefined || s.to === undefined ? '' : `${day(s.from)} to ${day(s.to)}`

  const lines = [
    `Agent Fusion Router usage, ${period}`,
    `Sessions ${s.sessions} · Turns ${s.turns} · Requests ${s.requests} · Subagents ${s.spawns}`,
    '',
    pad(header, widths),
    ...rows.map(r => pad(r, widths)),
    '',
    `Turns by tier: ${counts(s.turnsByTier)} (escalated ${s.escalatedTurns})`,
    `Turn outcomes: ${counts(s.turnsByOutcome)}`,
    `Routed: ${s.routedRequests} requests, ${s.routedSpawns} subagents`,
  ]

  if (s.wouldRouteRequests > 0) {
    lines.push(`Observe mode: the router would have changed ${s.wouldRouteRequests} requests`)
  }

  lines.push('', `Estimated cost: ${usd(s.costUsd)}`)

  if (s.routedRequests > 0) {
    lines.push(`Same tokens at the models asked for before routing: ${usd(s.unroutedCostUsd)}`)
  }
  if (s.wouldRouteRequests > 0) {
    lines.push(`Same tokens at the router's choices: ${usd(s.potentialCostUsd)}`)
  }
  if (s.unpricedModels.length > 0) {
    lines.push(`No price for: ${s.unpricedModels.join(', ')} (left out of the totals)`)
  }

  lines.push(
    '',
    `Estimates use Anthropic list prices as of ${PRICES_AS_OF}; they are not your bill.`,
    'On a Claude subscription, usage counts against plan limits, not dollars.',
    'Comparisons reuse the same token counts, so they ignore tokenizer and cache differences between models.',
  )

  return lines.join('\n')
}
