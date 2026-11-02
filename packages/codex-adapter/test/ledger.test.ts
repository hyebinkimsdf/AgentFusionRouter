import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { codexHome, formatCodexUsage, parseSessionLedger, readCodexLedger, summarizeCodexLedger } from '../src/index.ts'
import type { CodexLedger } from '../src/index.ts'

// A Codex 0.164 session (VS Code) with one auto-compaction, reduced to the lines
// a usage parser reads: every id replaced, timestamps shifted, no paths or text.
// Its compaction request (resp-034, 254,923 tokens) is in a token_usage_record
// but never reaches the running total, as openai/codex#47003 reports.
const FIXTURE = join(import.meta.dirname, 'fixtures', 'compaction-session.jsonl')

// Builders for the smaller cases, in the shape Codex writes.
let clock = 0
const at = () => new Date(Date.UTC(2026, 0, 1) + (clock += 1000)).toISOString()
const usage = (total: number, cached = 0) => ({
  input_tokens: total - 10,
  cached_input_tokens: cached,
  cache_write_input_tokens: 0,
  output_tokens: 10,
  reasoning_output_tokens: 4,
  total_tokens: total,
})
const line = (type: string, payload: object) => JSON.stringify({ timestamp: at(), type, payload })
const meta = (id = 's-1') => line('session_meta', { id, cli_version: '0.164.0' })
const turn = (turnId: string, model = 'gpt-6.1-sol') => line('turn_context', { turn_id: turnId, model, effort: 'medium' })
const record = (responseId: string, total: number, turnId = 't-1') =>
  line('token_usage_record', { session_id: 's-1', thread_id: 's-1', turn_id: turnId, response_id: responseId, usage: usage(total) })
const runningTotal = (total: number) => line('event_msg', { type: 'token_count', info: { total_token_usage: usage(total), last_token_usage: usage(total) } })
const compacted = (responseId: string) => line('compacted', { compaction_response_id: responseId })
const rollout = (...lines: string[]) => `${lines.join('\n')}\n`

const statuses = (text: string) => parseSessionLedger(text, 'f').intervals.map(i => i.status)
const ledgerOf = (...texts: string[]): CodexLedger => {
  const files = texts.map((t, i) => parseSessionLedger(t, `f${i}`))
  return { home: 'h', files, entries: files.flatMap(f => f.entries), crossFileDuplicates: 0 }
}

const fixtureText = await readFile(FIXTURE, 'utf8')

describe('a real session with auto-compaction', () => {
  const text = fixtureText
  const ledger = parseSessionLedger(text, 'compaction-session.jsonl')
  const summary = summarizeCodexLedger({ home: 'h', files: [ledger], entries: ledger.entries, crossFileDuplicates: 0 })

  test('every request record is in the ledger once', () => {
    const records = ledger.entries.filter(e => e.source === 'request_record')
    assert.equal(records.length, 57)
    assert.equal(new Set(records.map(e => e.requestId)).size, 57)
    assert.equal(summary.reconciliation.recordedTokens, 6_747_545)
  })

  test('the compaction request is counted, apart from the others, though the running total left it out', () => {
    const compaction = ledger.entries.filter(e => e.isCompaction)
    assert.deepEqual(
      compaction.map(e => [e.requestId, e.tokens.total, e.status]),
      [['resp-034', 254_923, 'compaction_not_in_total']],
    )
    assert.equal(ledger.finalTotal, 6_492_622)
    assert.equal(summary.reconciliation.compactionNotInTotal, 254_923)
    assert.equal(summary.byModel.find(m => m.isCompaction)?.requests, 1)
  })

  test('the difference from the running total is fully explained', () => {
    const r = summary.reconciliation
    assert.equal(r.ledgerTokens - r.runningTotal, 254_923)
    assert.equal(r.unexplainedExcess, 0)
    assert.equal(r.unaccounted, 0)
  })

  test('running totals repeated with no request add nothing', () => {
    assert.equal(summary.reconciliation.estimatedTokens, 0)
    assert.ok(ledger.intervals.some(i => i.status === 'matched' && i.recordTokens === 0 && i.totalDelta === 0))
  })

  test('each request takes its model from its turn', () => {
    assert.deepEqual([...new Set(ledger.entries.map(e => e.model))], ['gpt-6-astra'])
  })

  test('reading the same file again gives the same ledger', () => {
    assert.deepEqual(parseSessionLedger(text, 'compaction-session.jsonl'), ledger)
  })

  test('Windows line endings read the same', () => {
    assert.deepEqual(parseSessionLedger(text.replaceAll('\n', '\r\n'), 'compaction-session.jsonl'), ledger)
  })

  test('the report says where the difference went', () => {
    assert.match(formatCodexUsage(summary), /auto-compaction left out of the total\s+254,923/)
  })
})

describe('reconciling an interval', () => {
  test('a compaction event copied from a parent thread has no request and is not counted', () => {
    const ledger = parseSessionLedger(rollout(meta(), compacted('parent-r9'), turn('t-1'), record('r1', 100), runningTotal(100)), 'f')

    assert.equal(ledger.compactionEventsWithoutRecord, 1)
    assert.equal(ledger.entries.filter(e => e.isCompaction).length, 0)
    assert.deepEqual(ledger.intervals.map(i => i.status), ['matched'])
  })

  test('an excess counts as compaction only when it is exactly the compaction usage', () => {
    // 100 + 50 recorded, the total moved 120: the 30 left over is not the 50 of the compaction.
    const text = rollout(meta(), turn('t-1'), record('r1', 100), record('c1', 50), compacted('c1'), runningTotal(120))
    const ledger = parseSessionLedger(text, 'f')

    assert.deepEqual(statuses(text), ['unexplained_excess'])
    assert.equal(ledger.intervals[0]?.differenceTokens, 30)
    assert.equal(ledger.entries.reduce((n, e) => n + e.tokens.total, 0), 150, 'the records are kept once, never max()ed with the total')
  })

  test('records short of the total add only the shortfall, from the total', () => {
    const ledger = parseSessionLedger(rollout(meta(), turn('t-1'), record('r1', 40), runningTotal(100)), 'f')

    assert.deepEqual(
      ledger.entries.map(e => [e.source, e.tokens.total, e.status]),
      [
        ['request_record', 40, 'records_short'],
        ['cumulative_delta', 60, 'records_short'],
      ],
    )
  })

  test('a session with no request records falls back to the running total, repeats included', () => {
    const ledger = parseSessionLedger(rollout(meta(), turn('t-1', 'gpt-6-luna'), runningTotal(100), runningTotal(100), runningTotal(250)), 'f')

    assert.deepEqual(ledger.intervals.map(i => i.status), ['cumulative_only', 'matched', 'cumulative_only'])
    assert.deepEqual(ledger.entries.map(e => [e.source, e.tokens.total, e.model]), [
      ['cumulative_delta', 100, 'gpt-6-luna'],
      ['cumulative_delta', 150, 'gpt-6-luna'],
    ])
  })

  test('mixed formats: each interval uses its own source, and nothing is added twice', () => {
    const text = rollout(meta(), turn('t-1'), runningTotal(100), turn('t-2'), record('r1', 50, 't-2'), runningTotal(150))
    const ledger = parseSessionLedger(text, 'f')
    const summary = summarizeCodexLedger(ledgerOf(text))

    assert.deepEqual(ledger.intervals.map(i => i.status), ['cumulative_only', 'matched'])
    assert.equal(summary.reconciliation.ledgerTokens, 150)
    assert.equal(summary.reconciliation.unaccounted, 0)
  })

  test('a running total that goes down keeps the records and leaves the file out of the balance', () => {
    const text = rollout(meta(), turn('t-1'), record('r1', 100), runningTotal(100), record('r2', 30), runningTotal(30))
    const summary = summarizeCodexLedger(ledgerOf(text))

    assert.deepEqual(statuses(text), ['matched', 'total_reset'])
    assert.equal(summary.reconciliation.recordedTokens, 130)
    assert.equal(summary.reconciliation.filesWithReset, 1)
  })

  test('records after the last running total are kept and reported as not yet compared', () => {
    const summary = summarizeCodexLedger(ledgerOf(rollout(meta(), turn('t-1'), record('r1', 100), runningTotal(100), record('r2', 70))))

    assert.equal(summary.reconciliation.afterLastTotal, 70)
    assert.equal(summary.reconciliation.unaccounted, 0)
  })
})

describe('reading records safely', () => {
  test('a record repeated in one file is counted once', () => {
    const ledger = parseSessionLedger(rollout(meta(), turn('t-1'), record('r1', 100), record('r1', 100), runningTotal(100)), 'f')

    assert.equal(ledger.duplicateRecords, 1)
    assert.deepEqual(ledger.intervals.map(i => i.status), ['matched'])
  })

  test('a last line still being written is skipped, and a broken line elsewhere is counted', () => {
    const complete = rollout(meta(), turn('t-1'), record('r1', 100), '{"broken', runningTotal(100))
    const ledger = parseSessionLedger(`${complete}{"timestamp":"2026-01-01T00:00:09.000Z","type":"token_usa`, 'f')

    assert.equal(ledger.incompleteLastLine, true)
    assert.equal(ledger.malformedLines, 1)
    assert.equal(ledger.entries.length, 1)
  })

  test('a turn with no turn_context leaves the model unknown', () => {
    const text = rollout(meta(), record('r1', 100, 't-missing'), runningTotal(100))
    const ledger = parseSessionLedger(text, 'f')
    const summary = summarizeCodexLedger(ledgerOf(text))

    assert.equal(ledger.entries[0]?.model, undefined)
    assert.equal(summary.byModel[0]?.model, 'unknown')
  })

  test('cached input stays inside input and reasoning inside output, as Codex reports them', () => {
    const ledger = parseSessionLedger(rollout(meta(), turn('t-1'), line('token_usage_record', { turn_id: 't-1', response_id: 'r1', usage: usage(100, 60) }), runningTotal(100)), 'f')
    const tokens = ledger.entries[0]?.tokens

    assert.deepEqual(tokens, { input: 90, cachedInput: 60, cacheWriteInput: 0, output: 10, reasoningOutput: 4, total: 100 })
  })

  test('no message text reaches the ledger', () => {
    const text = rollout(
      meta(),
      turn('t-1'),
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'SECRET-PROMPT' }] }),
      record('r1', 100),
      runningTotal(100),
    )

    assert.doesNotMatch(JSON.stringify(parseSessionLedger(text, 'f')), /SECRET-PROMPT/)
  })
})

describe('the session folders', () => {
  test('CODEX_HOME moves the folder', () => {
    assert.equal(codexHome({ CODEX_HOME: 'D:\\codex' }), 'D:\\codex')
    assert.match(codexHome({}), /\.codex$/)
  })

  test('sessions and archived sessions are read, and a request in two files is counted once', async () => {
    const home = await mkdtemp(join(tmpdir(), 'afr-codex-'))
    try {
      await mkdir(join(home, 'sessions', '2026', '01', '01'), { recursive: true })
      await mkdir(join(home, 'archived_sessions'), { recursive: true })
      await writeFile(join(home, 'sessions', '2026', '01', '01', 'rollout-2026-01-01T00-00-00-a.jsonl'), rollout(meta('s-1'), turn('t-1'), record('r1', 100), runningTotal(100)))
      await writeFile(join(home, 'archived_sessions', 'rollout-2026-01-02T00-00-00-b.jsonl'), rollout(meta('s-2'), turn('t-1'), record('r1', 100), record('r2', 50), runningTotal(150)))
      await writeFile(join(home, 'sessions', 'notes.jsonl'), 'not a session')

      const ledger = await readCodexLedger(home)

      assert.deepEqual(ledger.files.map(f => f.file), ['sessions/2026/01/01/rollout-2026-01-01T00-00-00-a.jsonl', 'archived_sessions/rollout-2026-01-02T00-00-00-b.jsonl'])
      assert.equal(ledger.crossFileDuplicates, 1)
      assert.deepEqual(ledger.entries.map(e => e.requestId), ['r1', 'r2'])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
