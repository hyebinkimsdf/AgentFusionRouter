// A per-request usage ledger from one Codex session record (a rollout
// `.jsonl` file), reconciled with Codex's own running total.
//
// Two sources are kept apart. `token_usage_record` lines report each model
// request once, with its id: the ledger is built from them. `token_count`
// events carry Codex's running total: it is only compared with the records,
// interval by interval, except where no record covers an interval. The total
// is known to leave out auto-compaction requests (openai/codex#47003), so a
// ledger that matches it exactly would be wrong.
//
// Only token counts, ids, model names and timestamps are read. Message text
// is never kept.

/** Token counts as Codex reports them: `input` includes cached input, `output` includes reasoning. */
export type CodexTokens = {
  input: number
  cachedInput: number
  cacheWriteInput: number
  output: number
  reasoningOutput: number
  total: number
}

export type UsageSource = 'request_record' | 'cumulative_delta'

/**
 * How one interval (the lines up to a running-total event) reconciled.
 * - `matched`: the records add up to the total's change.
 * - `compaction_not_in_total`: the records add up to more, by exactly the
 *   compaction requests' usage, which the total leaves out.
 * - `unexplained_excess`: the records add up to more, and compaction does not
 *   account for it. The records are kept; the excess is reported.
 * - `records_short`: the records add up to less. The shortfall enters the
 *   ledger as one estimated entry, from the total.
 * - `cumulative_only`: no records at all (a Codex version that wrote none):
 *   the total's change is the only source.
 * - `total_reset`: the running total went down. The records are kept and the
 *   total is not used for this interval.
 * - `after_last_total`: records after the last running total, as in a session
 *   still being written: nothing to compare them with yet.
 */
export type IntervalStatus =
  | 'matched'
  | 'compaction_not_in_total'
  | 'unexplained_excess'
  | 'records_short'
  | 'cumulative_only'
  | 'total_reset'
  | 'after_last_total'

export type LedgerEntry = {
  file: string
  sessionId?: string
  /** The model request's id (`response_id`); absent on an estimated entry. */
  requestId?: string
  turnId?: string
  /** From the turn's `turn_context`; for an estimated entry, the turn context in effect. Absent when unknown. */
  model?: string
  effort?: string
  timestamp?: string
  tokens: CodexTokens
  /** An auto-compaction request: it costs tokens, but no router chose it. */
  isCompaction: boolean
  source: UsageSource
  status: IntervalStatus
}

export type IntervalSummary = {
  status: IntervalStatus
  /** The records' total tokens in the interval. */
  recordTokens: number
  /** The running total's change; absent after the last total. */
  totalDelta?: number
  compactionTokens: number
  /**
   * The ledger's tokens in the interval less the total's change: the
   * compaction usage the total left out, or an unexplained excess. Zero where
   * they match, where the ledger took the shortfall from the total, and where
   * there is no total to compare with.
   */
  differenceTokens: number
}

export type FileLedger = {
  file: string
  sessionId?: string
  cliVersion?: string
  /** `session_meta.thread_source`, when Codex recorded one. */
  threadSource?: string
  entries: LedgerEntry[]
  intervals: IntervalSummary[]
  /** Codex's running total at its last `token_count` event. */
  finalTotal?: number
  /** Records repeating a request id already in this file: dropped. */
  duplicateRecords: number
  /**
   * `compacted` lines whose `compaction_response_id` has no record here: copied
   * from a parent thread (subagent and review threads start with one), or
   * written by a Codex version that recorded no compaction usage. Not counted.
   */
  compactionEventsWithoutRecord: number
  /** Lines that are not JSON, other than an incomplete last line. */
  malformedLines: number
  /** The last line is not complete JSON yet: a session still being written. It is skipped. */
  incompleteLastLine: boolean
}

type Json = Record<string, unknown>

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

export const emptyCodexTokens = (): CodexTokens => ({ input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0 })

/** Codex's usage object (`input_tokens`, `cached_input_tokens`, ...) as CodexTokens. */
export const readCodexTokens = (raw: unknown): CodexTokens => {
  const u = (raw ?? {}) as Json
  return {
    input: num(u.input_tokens),
    cachedInput: num(u.cached_input_tokens),
    cacheWriteInput: num(u.cache_write_input_tokens),
    output: num(u.output_tokens),
    reasoningOutput: num(u.reasoning_output_tokens),
    total: num(u.total_tokens),
  }
}

export const addCodexTokens = (a: CodexTokens, b: CodexTokens): CodexTokens => ({
  input: a.input + b.input,
  cachedInput: a.cachedInput + b.cachedInput,
  cacheWriteInput: a.cacheWriteInput + b.cacheWriteInput,
  output: a.output + b.output,
  reasoningOutput: a.reasoningOutput + b.reasoningOutput,
  total: a.total + b.total,
})

/** a − b field by field, none below zero; `total` kept as input + output, as Codex reports it. */
const difference = (a: CodexTokens, b: CodexTokens): CodexTokens => {
  const input = Math.max(0, a.input - b.input)
  const output = Math.max(0, a.output - b.output)
  return {
    input,
    cachedInput: Math.max(0, a.cachedInput - b.cachedInput),
    cacheWriteInput: Math.max(0, a.cacheWriteInput - b.cacheWriteInput),
    output,
    reasoningOutput: Math.max(0, a.reasoningOutput - b.reasoningOutput),
    total: input + output,
  }
}

type Line =
  | { kind: 'record'; timestamp?: string; payload: Json }
  | { kind: 'total'; timestamp?: string; total: CodexTokens }
  | { kind: 'turn'; turnId?: string; model?: string; effort?: string }

/** Builds the ledger of one session record from its text. `file` names it in every entry. */
export const parseSessionLedger = (text: string, file: string): FileLedger => {
  const raw = text.split('\n')
  const hasTail = raw.at(-1) !== ''
  const lines: Line[] = []
  const turns = new Map<string, { model?: string; effort?: string }>()
  const compactionIds = new Set<string>()
  let sessionId: string | undefined
  let cliVersion: string | undefined
  let threadSource: string | undefined
  let malformedLines = 0
  let incompleteLastLine = false

  raw.forEach((line, i) => {
    if (line.trim() === '') return
    let json: Json
    try {
      json = JSON.parse(line) as Json
    } catch {
      if (hasTail && i === raw.length - 1) incompleteLastLine = true
      else malformedLines += 1
      return
    }
    const payload = (json.payload ?? {}) as Json
    const timestamp = str(json.timestamp)

    switch (json.type) {
      case 'session_meta':
        sessionId ??= str(payload.id) ?? str(payload.session_id)
        cliVersion ??= str(payload.cli_version)
        threadSource ??= typeof payload.thread_source === 'string' ? payload.thread_source : undefined
        return
      case 'turn_context': {
        const turnId = str(payload.turn_id)
        const turn = { model: str(payload.model), effort: str(payload.effort) }
        if (turnId !== undefined) turns.set(turnId, turn)
        lines.push({ kind: 'turn', turnId, ...turn })
        return
      }
      case 'token_usage_record':
        lines.push({ kind: 'record', timestamp, payload })
        return
      case 'compacted': {
        const id = str(payload.compaction_response_id)
        if (id !== undefined) compactionIds.add(id)
        return
      }
      case 'event_msg': {
        const info = payload.type === 'token_count' ? (payload.info as Json | null | undefined) : undefined
        if (info?.total_token_usage !== undefined) lines.push({ kind: 'total', timestamp, total: readCodexTokens(info.total_token_usage) })
        return
      }
    }
  })

  const entries: LedgerEntry[] = []
  const intervals: IntervalSummary[] = []
  const seen = new Set<string>()
  const recordedIds = new Set<string>()
  let duplicateRecords = 0
  let pending: LedgerEntry[] = []
  let previous: CodexTokens | undefined
  let inEffect: { turnId?: string; model?: string; effort?: string } = {}

  const close = (status: IntervalStatus, totalDelta: number | undefined, extra?: LedgerEntry) => {
    for (const e of pending) e.status = status
    const recordTokens = pending.reduce((n, e) => n + e.tokens.total, 0)
    const compactionTokens = pending.filter(e => e.isCompaction).reduce((n, e) => n + e.tokens.total, 0)
    entries.push(...pending, ...(extra === undefined ? [] : [extra]))
    intervals.push({
      status,
      recordTokens,
      ...(totalDelta === undefined ? {} : { totalDelta }),
      compactionTokens,
      differenceTokens: totalDelta === undefined || status === 'total_reset' ? 0 : recordTokens + (extra?.tokens.total ?? 0) - totalDelta,
    })
    pending = []
  }

  for (const line of lines) {
    if (line.kind === 'turn') {
      inEffect = line
      continue
    }

    if (line.kind === 'record') {
      const p = line.payload
      const requestId = str(p.response_id)
      if (requestId !== undefined && seen.has(requestId)) {
        duplicateRecords += 1
        continue
      }
      if (requestId !== undefined) {
        seen.add(requestId)
        recordedIds.add(requestId)
      }
      const turnId = str(p.turn_id)
      const turn = turnId === undefined ? undefined : turns.get(turnId)
      pending.push({
        file,
        ...optional('sessionId', str(p.session_id) ?? sessionId),
        ...optional('requestId', requestId),
        ...optional('turnId', turnId),
        ...optional('model', turn?.model),
        ...optional('effort', turn?.effort),
        ...optional('timestamp', line.timestamp),
        tokens: readCodexTokens(p.usage),
        isCompaction: requestId !== undefined && compactionIds.has(requestId),
        source: 'request_record',
        status: 'after_last_total',
      })
      continue
    }

    // A running total closes the interval of the records before it.
    const delta = previous === undefined ? line.total : difference(line.total, previous)
    const totalDelta = previous === undefined ? line.total.total : line.total.total - previous.total
    const isReset = previous !== undefined && line.total.total < previous.total
    previous = line.total

    if (isReset) {
      close('total_reset', totalDelta)
      continue
    }

    const records = pending.reduce((sum, e) => addCodexTokens(sum, e.tokens), emptyCodexTokens())
    const compaction = pending.filter(e => e.isCompaction).reduce((n, e) => n + e.tokens.total, 0)
    const estimated = (status: IntervalStatus, tokens: CodexTokens): LedgerEntry => ({
      file,
      ...optional('sessionId', sessionId),
      ...optional('turnId', inEffect.turnId),
      ...optional('model', inEffect.model),
      ...optional('effort', inEffect.effort),
      ...optional('timestamp', line.timestamp),
      tokens,
      isCompaction: false,
      source: 'cumulative_delta',
      status,
    })

    if (pending.length === 0) {
      if (totalDelta === 0) close('matched', 0)
      else close('cumulative_only', totalDelta, estimated('cumulative_only', delta))
    } else if (records.total === totalDelta) {
      close('matched', totalDelta)
    } else if (records.total > totalDelta) {
      close(records.total - totalDelta === compaction ? 'compaction_not_in_total' : 'unexplained_excess', totalDelta)
    } else {
      close('records_short', totalDelta, estimated('records_short', difference(delta, records)))
    }
  }

  if (pending.length > 0) close('after_last_total', undefined)

  const compactionEventsWithoutRecord = [...compactionIds].filter(id => !recordedIds.has(id)).length

  return {
    file,
    ...optional('sessionId', sessionId),
    ...optional('cliVersion', cliVersion),
    ...optional('threadSource', threadSource),
    entries,
    intervals,
    ...optional('finalTotal', previous?.total),
    duplicateRecords,
    compactionEventsWithoutRecord,
    malformedLines,
    incompleteLastLine,
  }
}

/** `{ [key]: value }`, or nothing when the value is absent: keeps undefined fields out of the ledger. */
const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
