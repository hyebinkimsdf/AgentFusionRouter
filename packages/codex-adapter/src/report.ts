import type { CodexTokens, FileLedger, LedgerEntry } from './ledger.ts'
import { addCodexTokens, emptyCodexTokens } from './ledger.ts'
import type { CodexLedger } from './sessions.ts'

export type CodexModelRow = {
  model: string
  /** Auto-compaction requests are a row of their own: they cost tokens, but no router chose them. */
  isCompaction: boolean
  requests: number
  /** Estimated entries (from the running total) in this row; their requests are unknown. */
  estimatedEntries: number
  tokens: CodexTokens
}

export type CodexReconciliation = {
  /** Tokens from request records (`token_usage_record`). */
  recordedTokens: number
  /** Tokens taken from the running total where records were missing or short. */
  estimatedTokens: number
  /** recorded + estimated, per file before cross-file duplicates are dropped. */
  ledgerTokens: number
  /** Codex's running totals (`token_count`) at the end of each file, summed. */
  runningTotal: number
  /** Auto-compaction usage that the running total left out (openai/codex#47003). */
  compactionNotInTotal: number
  /** Records beyond the running total that compaction does not explain. */
  unexplainedExcess: number
  /** Records after a file's last running total (a session still being written). */
  afterLastTotal: number
  /**
   * ledger − running total − the three above, over files whose total never
   * went down. Zero when every difference is accounted for.
   */
  unaccounted: number
  /** Files whose running total went down at least once: left out of `unaccounted`. */
  filesWithReset: number
}

export type CodexUsageSummary = {
  home: string
  files: number
  sessions: number
  from?: string
  to?: string
  cliVersions: string[]
  /** Request records in the ledger, after duplicates. */
  requests: number
  compactionRequests: number
  byModel: CodexModelRow[]
  reconciliation: CodexReconciliation
  compactionEventsWithoutRecord: number
  duplicateRecords: number
  crossFileDuplicates: number
  malformedLines: number
  filesStillBeingWritten: number
}

const sumIntervals = (f: FileLedger, status: string, pick: 'differenceTokens' | 'recordTokens'): number =>
  f.intervals.filter(i => i.status === status).reduce((n, i) => n + i[pick], 0)

const fileTokens = (f: FileLedger, source: LedgerEntry['source']): number =>
  f.entries.filter(e => e.source === source).reduce((n, e) => n + e.tokens.total, 0)

/** Folds a ledger into the report's figures: token counts only, no prices. */
export const summarizeCodexLedger = (ledger: CodexLedger): CodexUsageSummary => {
  const rows = new Map<string, CodexModelRow>()
  for (const e of ledger.entries) {
    const model = e.model ?? 'unknown'
    const key = `${model}\u0000${e.isCompaction}`
    const row = rows.get(key) ?? { model, isCompaction: e.isCompaction, requests: 0, estimatedEntries: 0, tokens: emptyCodexTokens() }
    if (e.source === 'request_record') row.requests += 1
    else row.estimatedEntries += 1
    row.tokens = addCodexTokens(row.tokens, e.tokens)
    rows.set(key, row)
  }

  const r: CodexReconciliation = {
    recordedTokens: 0,
    estimatedTokens: 0,
    ledgerTokens: 0,
    runningTotal: 0,
    compactionNotInTotal: 0,
    unexplainedExcess: 0,
    afterLastTotal: 0,
    unaccounted: 0,
    filesWithReset: 0,
  }
  for (const f of ledger.files) {
    const recorded = fileTokens(f, 'request_record')
    const estimated = fileTokens(f, 'cumulative_delta')
    const compaction = sumIntervals(f, 'compaction_not_in_total', 'differenceTokens')
    const unexplained = sumIntervals(f, 'unexplained_excess', 'differenceTokens')
    const afterLast = sumIntervals(f, 'after_last_total', 'recordTokens')
    r.recordedTokens += recorded
    r.estimatedTokens += estimated
    r.runningTotal += f.finalTotal ?? 0
    r.compactionNotInTotal += compaction
    r.unexplainedExcess += unexplained
    r.afterLastTotal += afterLast
    if (f.intervals.some(i => i.status === 'total_reset')) r.filesWithReset += 1
    else r.unaccounted += recorded + estimated - (f.finalTotal ?? 0) - compaction - unexplained - afterLast
  }
  r.ledgerTokens = r.recordedTokens + r.estimatedTokens

  const stamps = ledger.entries.flatMap(e => (e.timestamp === undefined ? [] : [e.timestamp])).sort()
  const requests = ledger.entries.filter(e => e.source === 'request_record')

  return {
    home: ledger.home,
    files: ledger.files.length,
    sessions: new Set(ledger.files.map(f => f.sessionId ?? f.file)).size,
    ...(stamps.length === 0 ? {} : { from: stamps[0], to: stamps.at(-1) }),
    cliVersions: [...new Set(ledger.files.flatMap(f => (f.cliVersion === undefined ? [] : [f.cliVersion])))].sort(),
    requests: requests.length,
    compactionRequests: requests.filter(e => e.isCompaction).length,
    byModel: [...rows.values()].sort((a, b) => Number(a.isCompaction) - Number(b.isCompaction) || b.tokens.total - a.tokens.total),
    reconciliation: r,
    compactionEventsWithoutRecord: ledger.files.reduce((n, f) => n + f.compactionEventsWithoutRecord, 0),
    duplicateRecords: ledger.files.reduce((n, f) => n + f.duplicateRecords, 0),
    crossFileDuplicates: ledger.crossFileDuplicates,
    malformedLines: ledger.files.reduce((n, f) => n + f.malformedLines, 0),
    filesStillBeingWritten: ledger.files.filter(f => f.incompleteLastLine).length,
  }
}

const exact = (n: number): string => n.toLocaleString('en-US')
const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${exact(Math.abs(n))}`

const pad = (cells: readonly string[], widths: readonly number[]): string =>
  cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join('  ')

/** The summary as plain text for a terminal. */
export const formatCodexUsage = (s: CodexUsageSummary): string => {
  if (s.files === 0) return `No Codex session records under ${s.home}.`

  const header = ['Model', 'Requests', 'Input', 'Cached', 'Output', 'Reasoning', 'Total']
  const rows = s.byModel.map(m => [
    `${m.model}${m.isCompaction ? ' (auto-compaction)' : ''}`,
    `${m.requests}${m.estimatedEntries > 0 ? ` + ${m.estimatedEntries} est.` : ''}`,
    exact(m.tokens.input),
    exact(m.tokens.cachedInput),
    exact(m.tokens.output),
    exact(m.tokens.reasoningOutput),
    exact(m.tokens.total),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)))
  const r = s.reconciliation
  const line = (label: string, value: string) => `  ${label.padEnd(48)}${value.padStart(16)}`
  const period = s.from === undefined || s.to === undefined ? '' : `, ${s.from.slice(0, 10)} to ${s.to.slice(0, 10)}`

  return [
    `Codex usage from ${s.home}${period}`,
    `Session files ${s.files} · Requests ${s.requests} (${s.compactionRequests} auto-compaction)${s.cliVersions.length === 0 ? '' : ` · Codex ${s.cliVersions.join(', ')}`}`,
    '',
    pad(header, widths),
    ...rows.map(row => pad(row, widths)),
    '',
    `Input includes cached input, and output includes reasoning, as Codex reports them.`,
    '',
    `Reconciliation with Codex's running total (token_count)`,
    line('From request records (token_usage_record)', exact(r.recordedTokens)),
    line('Estimated from the running total', exact(r.estimatedTokens)),
    line('Ledger', exact(r.ledgerTokens)),
    line("Codex's running total", exact(r.runningTotal)),
    line('Ledger − running total', signed(r.ledgerTokens - r.runningTotal)),
    line('  auto-compaction left out of the total', exact(r.compactionNotInTotal)),
    line('  unexplained excess in the records', exact(r.unexplainedExcess)),
    line('  records after the last running total', exact(r.afterLastTotal)),
    line('Unaccounted', `${signed(r.unaccounted)}${r.filesWithReset > 0 ? ` (${r.filesWithReset} file(s) with a reset left out)` : ''}`),
    '',
    `Compaction events with no usage record: ${s.compactionEventsWithoutRecord}. Copied from a parent thread, or written by a Codex version that recorded no compaction usage; not counted, so a total that includes such a version is a lower bound.`,
    `Duplicate records dropped: ${s.duplicateRecords} within files, ${s.crossFileDuplicates} across files · Malformed lines: ${s.malformedLines} · Sessions still being written: ${s.filesStillBeingWritten}`,
    '',
    'Token counts only: no prices yet.',
  ].join('\n')
}
