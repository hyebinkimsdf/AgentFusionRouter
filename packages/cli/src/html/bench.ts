import type { ModelEntry } from '@agent-fusion-router/core'
import { PRICES_AS_OF, TIERS } from '@agent-fusion-router/core'

import type { PriceCorrection } from '../bench/run.ts'
import type { BenchSummary } from '../bench/summary.ts'
import { outsideConversationTokens, priceCheck } from '../bench/summary.ts'
import type { Arm, RunResult, Task } from '../bench/types.ts'
import type { TaskValidation } from '../bench/validate.ts'
import {
  SERIES,
  barChart,
  compact,
  duration,
  esc,
  exactUsd,
  groupedBarChart,
  page,
  passMark,
  pct,
  priceAgreement,
  signedUsd,
  swatch,
  table,
  tile,
  tokenCounts,
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
  /** The price table the page's plugin estimates use: the current one. */
  prices: readonly ModelEntry[]
  /** Sessions whose recorded plugin estimate used an earlier, since-corrected price table. */
  correction?: PriceCorrection
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

  const { correction } = p
  const correctionNote =
    correction === undefined
      ? ''
      : `<div class="card" role="note" style="margin:16px 0"><strong>Plugin estimates shown with the current price table.</strong> This run recorded its plugin estimates with an earlier table (${esc(correction.recordedAsOf)}), corrected since: ${correction.sessions.length} session${correction.sessions.length === 1 ? '' : 's'} differ, listed under Verification. Claude Code's own costs, which every comparison figure uses, are unaffected. The recorded figures are unchanged in <code>results.json</code> and verify against the run's own table.</div>`

  const corrections =
    correction === undefined
      ? ''
      : `<h3>Price table corrected since this run</h3>
<p class="sub">The plugin's estimate for each affected session, as recorded with the run's table (${esc(correction.recordedAsOf)}) and with the current one, against what Claude Code reported.</p>
${table(
  ['Task', 'Arm', 'Rep', 'Claude Code computed', 'Recorded estimate', 'Current estimate'],
  correction.sessions.map(s => [
    `<code>${esc(s.taskId)}</code>`,
    armName(arms, s.armId),
    String(s.rep),
    exactUsd(s.claudeUsd),
    exactUsd(s.recordedUsd),
    exactUsd(s.currentUsd),
  ]),
  [2, 3, 4, 5],
)}`

  const header = `<h1>Agent Fusion Router benchmark</h1>
<p class="sub">Run <code>${esc(run.runId)}</code> · task set <strong>${esc(run.taskSet.name)}</strong> (${tasks.length} tasks) · ${arms.length} arms · ${run.reps} repetition${run.reps === 1 ? '' : 's'} · ${esc(run.startedAt)} · <a href="work.html">Work produced</a>: every change and answer, model by model</p>
${banner}
${correctionNote}`

  const cards = summary.arms
    .map(
      a => `<div class="card">
<div><strong>${armName(arms, a.armId)}</strong></div>
<div class="note">${esc(arms.find(x => x.id === a.armId)?.model ?? 'account default model')} · plugin ${esc(String(arms.find(x => x.id === a.armId)?.plugin.mode ?? 'observe'))} · answered by ${esc(modelsUsed(results, a.armId))}</div>
<div class="tiles">
${tile('Success', `${a.successes}/${a.validRuns}`, pct(a.successRate))}
${tile('Cost per completed task', usd(a.costPerSuccessUsd), a.unknownCostRuns ? `${a.unknownCostRuns} run(s) with unknown cost` : `Claude Code computed ${usd(a.costUsd)} in all`)}
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

  // The same runs grouped by the model that did the work rather than by arm:
  // auto routing spreads one arm over several models.
  const groups = new Map<string, RunResult[]>()
  for (const r of results.filter(x => x.valid)) {
    const key = r.plugin.models.map(m => m.replace(/^claude-/, '')).join(' → ') || 'unknown'
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const byModel = table(
    ['Model that did the work', 'Runs', 'Success', 'Session cost', 'Mean per run', 'Mean time', 'Tasks', 'In arms'],
    [...groups]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([model, runs]) => {
        const known = runs.filter(r => r.claude?.costUsd !== undefined)
        const cost = known.reduce((n, r) => n + (r.claude?.costUsd ?? 0), 0)
        const isKnown = known.length === runs.length
        const ok = runs.filter(r => r.success).length
        const armCounts = [...new Set(runs.map(r => r.armId))].map(id => `${esc(arms.find(a => a.id === id)?.label ?? id)} ${runs.filter(r => r.armId === id).length}`)

        return [
          `<strong>${esc(model)}</strong>`,
          String(runs.length),
          `${ok}/${runs.length} (${pct(ok / runs.length)})`,
          isKnown ? usd(cost) : `${usd(cost)} + ${runs.length - known.length} unknown`,
          isKnown ? usd(cost / runs.length) : '—',
          duration(runs.reduce((n, r) => n + r.wallMs, 0) / runs.length),
          esc([...new Set(runs.map(r => r.taskId))].join(', ')),
          armCounts.join(', '),
        ]
      }),
    [1, 2, 3, 4, 5],
  )

  // Two narrow tables rather than one wide one: a screenshot must not cut columns off.
  const common = summary.commonTasks ?? []
  const comparison = `${table(
    ['Arm', 'Valid runs', 'Success', 'Session cost', 'Per completed task', `On the ${common.length} tasks all completed`, 'Mean time', 'Mean turns'],
    summary.arms.map(a => [
      armName(arms, a.armId),
      `${a.validRuns}/${a.runs}`,
      `${a.successes} (${pct(a.successRate)})`,
      a.unknownCostRuns ? `${usd(a.costUsd)} + ${a.unknownCostRuns} unknown` : usd(a.costUsd),
      usd(a.costPerSuccessUsd),
      usd(a.commonTasksCostUsd),
      duration(a.meanWallMs),
      a.meanTurns.toFixed(1),
    ]),
    [1, 2, 3, 4, 5, 6, 7],
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

        const cost = cell?.unknownCostRuns ? `${usd(cell.costUsd)}+?` : usd(cell?.costUsd)

        return { value: cell?.costUsd ?? 0, text: `${cost} ${mark}` }
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

        const cost = cell.unknownCostRuns ? `${usd(cell.costUsd)} + ${cell.unknownCostRuns} unknown` : usd(cell.costUsd)

        return `${passMark(cell.successes === cell.runs)} ${cell.successes}/${cell.runs} · ${cost} · ${duration(cell.meanWallMs)}${tiers === '' ? '' : ` · <span class="sub">${esc(tiers)}</span>`}`
      }),
    ]),
  )

  const runRows = table(
    ['Task', 'Arm', 'Rep', 'Result', 'Session cost', 'Time', 'Turns', 'Router tier', 'Models answered', 'Diff (+/−)'],
    results.map(r => [
      `<code>${esc(r.taskId)}</code>`,
      armName(arms, r.armId),
      String(r.rep),
      r.valid ? passMark(r.success) : `<span class="fail">Invalid: ${esc(r.invalidReason ?? '')}</span>`,
      r.claude?.costUsd === undefined ? 'unknown' : usd(r.claude.costUsd),
      duration(r.wallMs),
      String(r.claude?.numTurns ?? '—'),
      esc(r.plugin.decidedTier ?? '—'),
      esc(r.plugin.models.join(', ') || '—'),
      `+${r.diff.added} / −${r.diff.removed}`,
    ]),
    [2, 4, 5, 6, 9],
  )

  // Per arm, then per run: the plugin's estimate, the difference, Claude Code's figure.
  const reconcileArms = table(
    ['Arm', 'Plugin estimate (sum of requests)', 'Difference', "Claude Code's computed session cost"],
    summary.arms.map(a => [
      armName(arms, a.armId),
      exactUsd(a.pluginEstimateUsd),
      a.differenceUsd === undefined ? 'unknown' : signedUsd(a.differenceUsd),
      a.unknownCostRuns ? `${exactUsd(a.costUsd)} + ${a.unknownCostRuns} unknown` : exactUsd(a.costUsd),
    ]),
    [1, 2, 3],
  )

  const reconcileRuns = table(
    ['Task', 'Arm', 'Rep', 'Plugin estimate', 'Difference', 'Claude Code computed', 'Tokens outside the conversation (in · out · cache rd · cache wr)', 'Price table check'],
    results
      .filter(r => r.valid)
      .map(r => [
        `<code>${esc(r.taskId)}</code>`,
        armName(arms, r.armId),
        String(r.rep),
        exactUsd(r.plugin.costUsd),
        r.claude?.costUsd === undefined ? 'unknown' : signedUsd(r.claude.costUsd - r.plugin.costUsd),
        r.claude?.costUsd === undefined ? 'unknown' : exactUsd(r.claude.costUsd),
        tokenCounts(outsideConversationTokens(r)),
        priceAgreement(priceCheck(r, p.prices)),
      ]),
    [2, 3, 4, 5, 6],
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
<p class="note">Every cost figure in this comparison is <strong>Claude Code's computed session cost</strong> (<code>total_cost_usd</code>): Claude Code's own figure at list prices, not a bill. The billed cost is in the provider's billing console and is not measured here, and on a subscription the same work counts against plan limits instead. Per completed task = session cost ÷ successes, so failed runs count. "On the tasks all completed" sums session cost over the ${common.length} task${common.length === 1 ? '' : 's'} every arm passed (${esc(common.join(', ') || 'none')}): a like-for-like figure. A run with no reported cost is shown as unknown, never as $0. Invalid runs are left out of every figure.</p>

<h2>By model</h2>
<p class="sub">The same runs grouped by the model that answered the conversation, as the plugin recorded it (<code>A → B</code>: both answered in one session). Claude Code's own side requests are not what did the work and are left out of this grouping, not out of the costs. To see what each model actually changed, open <a href="work.html">Work produced</a>.</p>
${byModel}

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
<h3>Cost reconciliation</h3>
<p class="sub">Three figures are kept apart. <strong>Plugin estimate</strong>: the plugin's per-request estimates, from the tokens it sees, priced with this project's table, which assumes 1-hour cache writes. <strong>Claude Code's computed session cost</strong>: Claude Code's own figure. <strong>Billed cost</strong>: not measured here.</p>
${reconcileArms}
<p class="note"><strong>Difference = Claude Code's computed session cost − plugin estimate.</strong> It holds requests the plugin does not see together with any estimation error, double counting or timing difference, and this data cannot split it by cause. A difference of zero shows the totals are arithmetically consistent, not that each request's estimate is right: errors can cancel. Mean absolute difference per run ${crossCheck.meanAbsDiffPct === undefined ? '—' : `${crossCheck.meanAbsDiffPct.toFixed(1)}%`}, largest ${crossCheck.maxAbsDiffPct === undefined ? '—' : `${crossCheck.maxAbsDiffPct.toFixed(1)}%`}.</p>
${reconcileRuns}
<p class="note"><strong>Tokens outside the conversation</strong> are observed, not estimated: Claude Code's per-model totals (<code>modelUsage</code>) less the conversation's tokens (<code>usage</code>), both from Claude Code's own output. What those requests were for is not recorded. <strong>Price table check</strong> prices Claude Code's own per-model token counts with this project's table and compares each with Claude Code's per-model figure (<code>costUSD</code>). It checks the table against Claude Code's computation, not against a bill, and found two errors in this project's table. A model whose session total passes a long-context threshold cannot be checked from totals and is skipped.</p>
${corrections}
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
