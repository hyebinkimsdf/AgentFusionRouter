import type { ModelEntry } from '@agent-fusion-router/core'

import type { RunCheck } from '../bench/run.ts'
import { outsideConversationUsd } from '../bench/summary.ts'
import type { Arm, RunResult } from '../bench/types.ts'
import type { RunInfo } from './bench.ts'
import { accounted, duration, esc, exactUsd, page, passMark, table } from './page.ts'

export type ComparedRun = {
  label: string
  run: RunInfo
  arms: readonly Arm[]
  results: readonly RunResult[]
  /** The price table the run was made with. */
  prices: readonly ModelEntry[]
  check: RunCheck
}

const exact = exactUsd

const diff = (plugin: number, claude: number | undefined): string => {
  if (claude === undefined || claude === 0) return '—'
  const pct = ((plugin - claude) / claude) * 100
  const text = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`

  return Math.abs(pct) < 0.005 ? `<span class="pass">✓ ${text}</span>` : `<span class="fail">${text}</span>`
}

const key = (r: RunResult): string => `${r.taskId}|${r.armId}|${r.rep}`

const armLabel = (arms: readonly Arm[], id: string): string => esc(arms.find(a => a.id === id)?.label ?? id)

const runCard = (c: ComparedRun): string => {
  const verified = c.check.problems.length === 0
  const status = verified
    ? `<span class="pass">✓ Verified</span>: every file matches its hash and every figure matches the raw files (${c.check.runs} runs).`
    : `<span class="fail">✗ Not verified</span><br>${c.check.problems.map(p => esc(p)).join('<br>')}`

  return `<div class="card">
<div><strong>${esc(c.label)}</strong></div>
<div class="note">Run <code>${esc(c.run.runId)}</code>${c.run.simulated ? ' · SIMULATED' : ''} · started ${esc(c.run.startedAt)}</div>
${table(
  ['', ''],
  [
    ['Claude Code', `<code>${esc(c.run.environment['Claude Code'] ?? '')}</code>`],
    ['Repository commit', `<code>${esc(c.run.environment['Repository commit'] ?? '')}</code>`],
    ['Plugin bundle SHA-256', `<span class="hash">${esc(c.run.environment['Plugin bundle SHA-256'] ?? '')}</span>`],
    ['Data SHA-256', `<span class="hash"><strong>${esc(c.check.dataHash)}</strong></span>`],
  ],
)}
<p style="margin-top:10px">${status}</p>
${c.check.notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
</div>`
}

/** Two benchmark runs side by side: what each recorded, and whether each still verifies. */
export const renderComparison = (a: ComparedRun, b: ComparedRun, generatedAt: string): string => {
  const keys = [...new Set([...a.results.map(key), ...b.results.map(key)])]
  const find = (c: ComparedRun, k: string) => c.results.find(r => key(r) === k)
  const name = (k: string) => {
    const [task = '', arm = '', rep = ''] = k.split('|')
    const arms = a.arms.some(x => x.id === arm) ? a.arms : b.arms

    return `<code>${esc(task)}</code> · ${armLabel(arms, arm)} · rep ${esc(rep)}`
  }

  const costRows = (k: string) =>
    [a, b].flatMap(c => {
      const r = find(c, k)
      if (!r) return []
      const outside = outsideConversationUsd(r, c.prices)
      const claude = r.claude?.costUsd
      const sum = outside === undefined ? undefined : r.plugin.costUsd + outside

      return [
        [
          name(k),
          esc(c.label),
          exact(claude),
          exact(r.plugin.costUsd),
          diff(r.plugin.costUsd, claude),
          exact(outside),
          exact(sum),
          accounted(sum === undefined || claude === undefined ? undefined : sum - claude),
        ],
      ]
    })

  const costs = table(
    ['Run of', 'Run', 'Claude Code total', 'Plugin estimate', 'Difference', 'Outside the conversation', 'Plugin + outside', 'Accounted for'],
    keys.flatMap(costRows),
    [2, 3, 4, 5, 6],
  )

  // The plugin sees the conversation's requests, so that is what it must match.
  const sameTokens = (r: RunResult): string => {
    const seen = r.claude?.conversationTokens ?? r.claude?.tokens

    return seen && JSON.stringify(seen) === JSON.stringify(r.plugin.tokens)
      ? '<span class="pass">✓ same as the conversation</span>'
      : '<span class="fail">differs</span>'
  }

  const rowsFor = (k: string) =>
    [a, b].flatMap(c => {
      const r = find(c, k)
      if (!r) return []
      const t = r.claude?.tokens

      return [
        [
          name(k),
          esc(c.label),
          String(t?.input ?? '—'),
          String(t?.output ?? '—'),
          String(t?.cacheRead ?? '—'),
          String(t?.cacheWrite ?? '—'),
          sameTokens(r),
          r.valid ? passMark(r.success) : `<span class="fail">Invalid</span>`,
          esc(r.plugin.models.join(', ') || '—'),
          esc(r.plugin.decidedTier ?? '—'),
          duration(r.wallMs),
        ],
      ]
    })

  const details = table(
    ['Run of', 'Run', 'Input', 'Output', 'Cache read', 'Cache write', 'Plugin tokens', 'Result', 'Model answered', 'Tier', 'Time'],
    keys.flatMap(rowsFor),
    [2, 3, 4, 5, 10],
  )

  const simulated = a.run.simulated || b.run.simulated
  const body = `<h1>Run comparison</h1>
<p class="sub"><strong>${esc(a.label)}</strong> (<code>${esc(a.run.runId)}</code>) and <strong>${esc(b.label)}</strong> (<code>${esc(b.run.runId)}</code>) · generated ${esc(generatedAt)}</p>
${simulated ? '<div class="banner" role="note"><strong>⚠ A simulated run is included</strong>Its numbers were generated without calling a model.</div>' : ''}
<h2>Runs</h2>
<div class="cards">${runCard(a)}${runCard(b)}</div>

<h2>Cost: Claude Code's report against the plugin's estimate</h2>
<p class="sub">Claude Code's total is <code>total_cost_usd</code> from its own report of the session. The plugin's estimate is computed from the tokens it recorded at each request of the conversation, with the run's price table. Claude Code also makes requests outside the conversation (session titles, summaries) that the plugin never sees: their cost is Claude Code's total tokens less the conversation's (<code>usage</code>), at the same prices. "Accounted for" checks that plugin plus outside equals Claude Code's total.</p>
${costs}

<h2>Tokens and outcome</h2>
<p class="sub">Tokens as Claude Code reported them for every request of the session. "Plugin tokens" says whether the plugin recorded exactly the conversation's four counts.</p>
${details}

<footer>Agent Fusion Router · ${esc(a.label)} data SHA-256 ${esc(a.check.dataHash)} · ${esc(b.label)} data SHA-256 ${esc(b.check.dataHash)}</footer>`

  return page(`Comparison: ${a.label} and ${b.label}`, body)
}
