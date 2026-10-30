import type { ModelEntry } from '@agent-fusion-router/core'
import { PRICES_AS_OF, TIERS } from '@agent-fusion-router/core'

import type { BenchSummary } from '../bench/summary.ts'
import { unaccountedUsd } from '../bench/summary.ts'
import type { Arm, RunResult, Task } from '../bench/types.ts'
import type { TaskValidation } from '../bench/validate.ts'
import {
  SERIES,
  accounted,
  barChart,
  compact,
  duration,
  esc,
  groupedBarChart,
  page,
  passMark,
  pct,
  swatch,
  table,
  tile,
  usd,
} from './page.ts'

export type RunInfo = {
  runId: string
  simulated: boolean
  startedAt: string
  finishedAt: string
  taskSet: { name: string; file: string; sha256: string }
  reps: number
  budgetUsd: number
  environment: Record<string, string>
  validation: TaskValidation[]
}

export type BenchPage = {
  run: RunInfo
  tasks: readonly Task[]
  arms: readonly Arm[]
  results: readonly RunResult[]
  summary: BenchSummary
  dataHash: string
  /** The price table the run was made with. */
  prices: readonly ModelEntry[]
}

const armColor = (arms: readonly Arm[], id: string): string => SERIES[arms.findIndex(a => a.id === id) % SERIES.length] ?? SERIES[0]

/** The models that answered an arm's conversations, as the plugin recorded them. */
const modelsUsed = (results: readonly RunResult[], armId: string): string =>
  [...new Set(results.filter(r => r.armId === armId).flatMap(r => r.plugin.models))].sort().join(', ') || 'unknown'

const armName = (arms: readonly Arm[], id: string): string => {
  const arm = arms.find(a => a.id === id)

  return arm === undefined ? esc(id) : `${swatch(armColor(arms, id))}${esc(arm.label)}`
}

export const renderBenchReport = (p: BenchPage): string => {
  const { run, tasks, arms, results, summary } = p

  const banner = run.simulated
    ? `<div class="banner" role="note"><strong>⚠ Simulated run: no model was called</strong>
The numbers below were generated to test the runner, the report and the evidence files. They are not experiment results.</div>`
    : ''

  const header = `<h1>Agent Fusion Router benchmark</h1>
<p class="sub">Run <code>${esc(run.runId)}</code> · task set <strong>${esc(run.taskSet.name)}</strong> (${tasks.length} tasks) · ${arms.length} arms · ${run.reps} repetition${run.reps === 1 ? '' : 's'} · ${esc(run.startedAt)}</p>
${banner}`

  const cards = summary.arms
    .map(
      a => `<div class="card">
<div><strong>${armName(arms, a.armId)}</strong></div>
<div class="note">${esc(arms.find(x => x.id === a.armId)?.model ?? 'account default model')} · plugin ${esc(String(arms.find(x => x.id === a.armId)?.plugin.mode ?? 'observe'))} · answered by ${esc(modelsUsed(results, a.armId))}</div>
<div class="tiles">
${tile('Success', `${a.successes}/${a.validRuns}`, pct(a.successRate))}
${tile('Cost per completed task', usd(a.costPerSuccessUsd), `total ${usd(a.costUsd)}`)}
${tile('Mean time per run', duration(a.meanWallMs))}
${tile('Tokens', compact(a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite), `${compact(a.tokens.output)} output`)}
</div></div>`,
    )
    .join('\n')

  const charts = `<div class="charts">
${barChart(
  summary.arms.map(a => ({
    label: arms.find(x => x.id === a.armId)?.label ?? a.armId,
    value: a.costPerSuccessUsd ?? 0,
    color: armColor(arms, a.armId),
    text: usd(a.costPerSuccessUsd),
  })),
  'Cost per completed task (lower is better)',
)}
${barChart(
  summary.arms.map(a => ({
    label: arms.find(x => x.id === a.armId)?.label ?? a.armId,
    value: a.successRate,
    color: armColor(arms, a.armId),
    text: `${pct(a.successRate)} (${a.successes}/${a.validRuns})`,
  })),
  'Success rate',
)}
</div>`

  // Two narrow tables rather than one wide one: a screenshot must not cut columns off.
  const comparison = `${table(
    ['Arm', 'Valid runs', 'Success', 'Total cost', 'Per completed task', 'Mean time', 'Mean turns'],
    summary.arms.map(a => [
      armName(arms, a.armId),
      `${a.validRuns}/${a.runs}`,
      `${a.successes} (${pct(a.successRate)})`,
      usd(a.costUsd),
      usd(a.costPerSuccessUsd),
      duration(a.meanWallMs),
      a.meanTurns.toFixed(1),
    ]),
    [1, 2, 3, 4, 5, 6],
  )}
<div style="height:12px"></div>
${table(
  ['Arm', 'Input', 'Output', 'Cache read', 'Cache write', 'Escalations', 'Permission denials', 'Lines changed'],
  summary.arms.map(a => [
    armName(arms, a.armId),
    compact(a.tokens.input),
    compact(a.tokens.output),
    compact(a.tokens.cacheRead),
    compact(a.tokens.cacheWrite),
    String(a.escalations),
    String(a.permissionDenials),
    String(a.linesChanged),
  ]),
  [1, 2, 3, 4, 5, 6, 7],
)}`

  const perTaskChart = groupedBarChart(
    tasks.map(t => ({
      label: t.id,
      bars: arms.map(a => {
        const cell = summary.cells.find(c => c.taskId === t.id && c.armId === a.id)
        const mark = cell && cell.runs > 0 ? (cell.successes === cell.runs ? '✓' : `✗ ${cell.successes}/${cell.runs}`) : '—'

        return { value: cell?.costUsd ?? 0, text: `${usd(cell?.costUsd)} ${mark}` }
      }),
    })),
    arms.map(a => ({ label: a.label, color: armColor(arms, a.id) })),
    'Cost per task by arm (✓ every run passed)',
  )

  const perTask = table(
    ['Task', 'Kind', 'Expected tier', ...arms.map(a => a.label)],
    tasks.map(t => [
      `<code>${esc(t.id)}</code>`,
      esc(t.kind),
      esc(t.expectedTier),
      ...arms.map(a => {
        const cell = summary.cells.find(c => c.taskId === t.id && c.armId === a.id)
        if (!cell || cell.runs === 0) return '—'
        const tiers = [...new Set(cell.decidedTiers)].join('/')

        return `${passMark(cell.successes === cell.runs)} ${cell.successes}/${cell.runs} · ${usd(cell.costUsd)} · ${duration(cell.meanWallMs)}${tiers === '' ? '' : ` · <span class="sub">${esc(tiers)}</span>`}`
      }),
    ]),
  )

  const runRows = table(
    ['Task', 'Arm', 'Rep', 'Result', 'Claude cost', 'Plugin estimate', 'Cost accounted for', 'Time', 'Turns', 'Router tier', 'Models answered', 'Diff (+/−)'],
    results.map(r => [
      `<code>${esc(r.taskId)}</code>`,
      armName(arms, r.armId),
      String(r.rep),
      r.valid ? passMark(r.success) : `<span class="fail">Invalid: ${esc(r.invalidReason ?? '')}</span>`,
      usd(r.claude?.costUsd),
      usd(r.plugin.costUsd),
      accounted(unaccountedUsd(r, p.prices)),
      duration(r.wallMs),
      String(r.claude?.numTurns ?? '—'),
      esc(r.plugin.decidedTier ?? '—'),
      esc(r.plugin.models.join(', ') || '—'),
      `+${r.diff.added} / −${r.diff.removed}`,
    ]),
    [2, 4, 5, 7, 8, 11],
  )

  const { classifier, crossCheck } = summary
  const matrix = table(
    ['Expected (row) → decided (column)', ...TIERS],
    TIERS.map(e => [esc(e), ...TIERS.map(d => String(classifier.matrix[e][d]))]),
    [1, 2, 3],
  )

  const validation = table(
    ['Task', 'Check fails on the untouched project', 'Check passes with the reference solution', 'Sound'],
    run.validation.map(v => [`<code>${esc(v.taskId)}</code>`, passMark(v.failsBefore), passMark(v.passesAfter), passMark(v.ok)]),
  )

  const invalid =
    summary.invalid.length === 0
      ? '<p>No invalid runs.</p>'
      : table(
          ['Task', 'Arm', 'Rep', 'Why it was left out'],
          summary.invalid.map(i => [`<code>${esc(i.taskId)}</code>`, armName(arms, i.armId), String(i.rep), esc(i.reason)]),
        )

  const environment = table(
    ['', ''],
    [
      ...Object.entries(run.environment).map(([k, v]) => [esc(k), `<code>${esc(v)}</code>`]),
      ['Task set file', `<code>${esc(run.taskSet.file)}</code>`],
      ['Task set SHA-256', `<span class="hash">${esc(run.taskSet.sha256)}</span>`],
      ['Budget cap per run', usd(run.budgetUsd)],
      ['Started', esc(run.startedAt)],
      ['Finished', esc(run.finishedAt)],
    ],
  )

  const body = `${header}
<h2>Result by arm</h2>
<div class="cards">${cards}</div>
<h2>Comparison</h2>
${charts}
<h3>All measures</h3>
${comparison}
<p class="note">Cost is what Claude Code reported for each session (<code>total_cost_usd</code>), at API list prices; on a subscription the same work counts against plan limits instead. Per completed task = total cost ÷ successes, so failed runs count. Invalid runs are left out of every figure.</p>

<h2>By task</h2>
${perTaskChart}
${perTask}

<h2>Every run</h2>
${runRows}
<h3>Invalid runs</h3>
${invalid}

<h2>Verification</h2>
<h3>Are the checks sound?</h3>
<p class="sub">Before any model ran, each task's hidden check was run on the untouched project (it must fail) and on the reference solution (it must pass).</p>
${validation}
<h3>Does the plugin record what Claude Code reports?</h3>
<p class="sub">For each run, the plugin's estimate from its own step records against Claude Code's reported cost. Mean absolute difference ${crossCheck.meanAbsDiffPct === undefined ? '—' : `${crossCheck.meanAbsDiffPct.toFixed(1)}%`}, largest ${crossCheck.maxAbsDiffPct === undefined ? '—' : `${crossCheck.maxAbsDiffPct.toFixed(1)}%`}. The plugin sees the conversation's requests only; Claude Code also makes its own side requests (session titles, summaries). "Cost accounted for" in the table above adds those side requests, priced from Claude Code's total tokens less the conversation's, and checks the sum against Claude Code's total.</p>
<h3>How often did the router pick the expected tier?</h3>
<p class="sub">${classifier.scored === 0 ? 'No decisions recorded.' : `${classifier.correct} of ${classifier.scored} decisions (${pct(classifier.correct / classifier.scored)}), counted over every arm: observe-mode arms record the same decision without applying it.`}</p>
${matrix}

<h2>Evidence</h2>
${environment}
<h3>Data hash</h3>
<p>SHA-256 of <code>evidence.sha256</code>, which lists the SHA-256 of every raw file in this run folder:</p>
<p class="hash"><strong>${esc(p.dataHash)}</strong></p>
<p class="sub">To check it, run these in the run folder. The first command re-hashes every file; the second recomputes every figure on this page from the raw files.</p>
<pre>sha256sum -c evidence.sha256
sha256sum evidence.sha256
node packages/cli/dist/cli.js bench verify benchmarks/results/${esc(run.runId)}</pre>

<footer>Agent Fusion Router · run ${esc(run.runId)}${run.simulated ? ' · SIMULATED' : ''} · data SHA-256 ${esc(p.dataHash)} · prices as of ${PRICES_AS_OF}</footer>`

  return page(`Benchmark ${run.runId}${run.simulated ? ' (simulated)' : ''}`, body)
}
