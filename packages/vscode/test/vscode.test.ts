import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'

import { summarize } from '@agent-fusion-router/core'

import { renderDetails } from '../src/details.ts'
import { money, periodStart, statusText, toFigures, tooltipText } from '../src/figures.ts'
import type { Figures } from '../src/figures.ts'
import { createLoader } from '../src/load.ts'
import type { Settings } from '../src/load.ts'

const NOW = new Date(2026, 10, 2, 15, 30)

// A routed Claude request: Haiku answered what Opus was asked for.
const claudeStep = (ts: number) =>
  JSON.stringify({
    v: 1,
    kind: 'step',
    ts,
    product: 'claude-code',
    session: 's',
    turn: 't',
    step: 0,
    mode: 'route',
    tier: 'light',
    requestedModel: 'claude-opus-5-5',
    applied: true,
    model: 'claude-haiku-5-5',
    tokens: { input: 100_000, output: 1_000, cacheRead: 0, cacheWrite: 0 },
  })

// A Codex turn on Astra with a light prompt.
const codexSession = (at: Date, responseId: string) =>
  [
    { type: 'session_meta', payload: { id: 'session-1', cli_version: '0.165.0' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${responseId}` } },
    { type: 'turn_context', payload: { turn_id: `turn-${responseId}`, model: 'gpt-6-astra', effort: 'xhigh' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'fix the typo in README.md' } },
    {
      type: 'token_usage_record',
      payload: {
        turn_id: `turn-${responseId}`,
        response_id: responseId,
        usage: { input_tokens: 10_000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0, total_tokens: 10_100 },
      },
    },
  ]
    .map(l => JSON.stringify({ timestamp: at.toISOString(), ...l }))
    .join('\n') + '\n'

describe('the status bar figures', () => {
  test('today starts at local midnight; the others count days back', () => {
    assert.equal(periodStart('today', NOW), new Date(2026, 10, 2).getTime())
    assert.equal(periodStart('7d', NOW), NOW.getTime() - 7 * 86_400_000)
  })

  test('a routed Claude period shows a savings estimate; an observed one shows potential', () => {
    const routed = toFigures('today', summarize([JSON.parse(claudeStep(NOW.getTime()))]), undefined)
    assert.ok((routed.claude?.routingSavingsUsd ?? 0) > 0)
    assert.equal(routed.claude?.potentialSavingsUsd, undefined)

    const observed = toFigures('today', summarize([{ ...JSON.parse(claudeStep(NOW.getTime())), mode: 'observe', applied: false, model: 'claude-opus-5-5' }]), undefined)
    assert.equal(observed.claude?.routingSavingsUsd, undefined)
    assert.ok((observed.claude?.potentialSavingsUsd ?? -1) >= 0)
  })

  test('the entry names each agent and what kind of figure it shows, in Korean or English', () => {
    const f: Figures = { period: 'today', claude: { requests: 3, costUsd: 1, routingSavingsUsd: 0.42 }, codex: { requests: 5, costUsd: 9, potentialSavingsUsd: 0.31 } }

    assert.equal(statusText(f, 'ko'), '$(graph-line) Claude 절감 추정 $0.42 · Codex 잠재 $0.31')
    assert.equal(statusText(f, 'en'), '$(graph-line) Claude saved (est.) $0.42 · Codex potential $0.31')
    assert.equal(statusText({ period: 'today' }, 'ko'), '$(graph-line) 기록 없음')
  })

  test('the hover says every amount is at API list prices, and which one is a simulation', () => {
    const f: Figures = { period: 'today', claude: { requests: 3, costUsd: 1, routingSavingsUsd: 0.42 }, codex: { requests: 5, costUsd: 9, potentialSavingsUsd: 0.31, standardModel: 'sol' } }
    const ko = tooltipText(f, 'ko')

    assert.match(ko, /API 요금 환산, 같은 토큰 기준이며 측정된 절감이 아닙니다/)
    assert.match(ko, /일반 작업을 sol로 처리하는 정책 기준입니다\. API 요금 환산 시뮬레이션이며 실제로 절약한 금액이 아닙니다/)
    assert.match(tooltipText({ ...f, codex: { requests: 5, costUsd: 9, potentialSavingsUsd: 0 } }, 'ko'), /기본 정책\(일반 작업은 그 턴의 모델 유지\) 기준이며, 설정 agentFusionRouter\.codexStandardModel/)
    assert.match(ko, /ChatGPT 플랜에서는 이 금액이 청구되지 않습니다/)
    assert.match(tooltipText(f, 'en'), /a simulation, not a saving that happened/)
  })

  test('a negative amount keeps its sign', () => {
    assert.equal(money(-1.234), '−$1.23')
  })
})

describe('reading the records', () => {
  let root: string
  let settings: Settings

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'afr-vscode-'))
    const logs = join(root, 'logs')
    const sessions = join(root, 'codex', 'sessions', '2026', '11', '02')
    await mkdir(logs, { recursive: true })
    await mkdir(sessions, { recursive: true })
    await writeFile(join(logs, 'today.jsonl'), `${claudeStep(Date.now())}\n${claudeStep(Date.now() - 3 * 86_400_000)}\n`)
    await writeFile(join(sessions, 'rollout-2026-11-02T10-00-00-a.jsonl'), codexSession(new Date(), 'r-1'))
    // Last written two days ago: it cannot hold anything from today.
    const old = join(sessions, 'rollout-2026-10-31T10-00-00-old.jsonl')
    await writeFile(old, codexSession(new Date(Date.now() - 2 * 86_400_000), 'r-old'))
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000)
    await utimes(old, twoDaysAgo, twoDaysAgo)
    settings = { period: 'today', claudeLogDir: logs, codexHome: join(root, 'codex'), codexStandardModel: '' }
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('only the period counts, and a file last written before it is not opened', async () => {
    const loader = createLoader()
    const loaded = await loader.load(settings, new Date())

    assert.equal(loaded.claude.requests, 1, 'the record from three days ago is left out')
    assert.equal(loaded.figures.codex?.requests, 1)
    assert.deepEqual(
      loaded.codex?.ledger.files.map(f => f.file),
      ['sessions/2026/11/02/rollout-2026-11-02T10-00-00-a.jsonl'],
    )
    assert.ok((loaded.figures.codex?.potentialSavingsUsd ?? 0) > 0, 'a light turn on Astra would have moved to Luna')
  })

  test('an unchanged file is not read again; a changed one is', async () => {
    const loader = createLoader()
    await loader.load(settings, new Date())
    const first = loader.claudeFiles.reads
    await loader.load(settings, new Date())
    assert.equal(loader.claudeFiles.reads, first)

    await appendFile(join(settings.claudeLogDir, 'today.jsonl'), `${claudeStep(Date.now())}\n`)
    const loaded = await loader.load(settings, new Date())
    assert.equal(loader.claudeFiles.reads, first + 1)
    assert.equal(loaded.claude.requests, 2)
  })

  test('missing folders are an empty period, not an error', async () => {
    const loaded = await createLoader().load({ ...settings, claudeLogDir: join(root, 'none'), codexHome: join(root, 'none') }, new Date())

    assert.equal(loaded.figures.claude, undefined)
    assert.equal(loaded.figures.codex, undefined)
    assert.equal(statusText(loaded.figures, 'en'), '$(graph-line) no usage')
  })

  test('a standard model for Codex is simulated, and an unknown one is refused', async () => {
    const loaded = await createLoader().load({ ...settings, codexStandardModel: 'sol' }, new Date())
    assert.equal(loaded.figures.codex?.standardModel, 'sol')
    await assert.rejects(createLoader().load({ ...settings, codexStandardModel: 'gpt-9' }, new Date()), /no Codex model "gpt-9"/)
  })

  test('the details page runs no script, escapes what it shows and states the basis', async () => {
    const loaded = await createLoader().load(settings, new Date())
    const html = renderDetails({ ...loaded, claudeDir: '<logs>' }, 'ko', NOW)

    assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"/)
    assert.doesNotMatch(html, /<script/i)
    assert.match(html, /&lt;logs&gt;/)
    assert.match(html, /모든 금액은 API 요금 환산 추정치입니다/)
    assert.match(html, /Potential savings: .* \(API list prices, simulation; not a saving that happened\)/)
  })
})
