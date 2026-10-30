import { esc, exactUsd, page, passMark, table } from './page.ts'

export type IndexRun = {
  runId: string
  startedAt: string
  simulated: boolean
  tasks: number
  arms: string[]
  reps: number
  runs: number
  successes: number
  /** Sum of Claude Code's own `total_cost_usd` over the run's sessions. */
  claudeCostUsd: number
  /** Runs whose cost reconciles to the last digit, of those that can be reconciled. */
  accounted: { matched: number; checked: number }
  verified: boolean
  problems: string[]
  dataHash: string
  /** Paths relative to the index page. */
  report: string
  screenshot?: string
  /** Each session's raw Claude Code output, for reading the reported figures first-hand. */
  raw: { label: string; path: string; costUsd?: number }[]
}

export type IndexComparison = {
  name: string
  labelA: string
  labelB: string
  runA: string
  runB: string
  generatedAt: string
  page: string
  screenshot?: string
}

const shot = (path: string | undefined, href: string): string =>
  path === undefined
    ? '<div class="thumb empty">No screenshot</div>'
    : `<a href="${esc(path)}"><img class="thumb" src="${esc(path)}" alt="Screenshot"></a><div class="note"><a href="${esc(href)}">Open the page</a> · <a href="${esc(path)}">Full screenshot</a></div>`

const runCard = (r: IndexRun): string => {
  const raw =
    r.raw.length <= 6
      ? r.raw
          .map(x => `<li><a href="${esc(x.path)}"><code>${esc(x.label)}</code></a>: total_cost_usd ${exactUsd(x.costUsd)}</li>`)
          .join('')
      : `<li>${r.raw.length} sessions: see each run's <code>claude.json</code> under <a href="results/${esc(r.runId)}/runs/"><code>runs/</code></a></li>`

  return `<div class="card entry">
<div class="shot">${shot(r.screenshot, r.report)}</div>
<div class="facts">
<div><strong><a href="${esc(r.report)}">${esc(r.runId)}</a></strong> ${r.simulated ? '<span class="fail">SIMULATED: not a result</span>' : ''}</div>
<div class="note">${esc(r.startedAt)} · ${r.tasks} task${r.tasks === 1 ? '' : 's'} × ${r.arms.length} arm${r.arms.length === 1 ? '' : 's'} (${esc(r.arms.join(', '))}) × ${r.reps} rep</div>
${table(
  ['', ''],
  [
    ['Success', `${r.successes}/${r.runs}`],
    ['Claude Code total', exactUsd(r.claudeCostUsd)],
    [
      'Cost accounted for',
      r.accounted.checked === 0
        ? '—'
        : r.accounted.matched === r.accounted.checked
          ? `<span class="pass">✓ ${r.accounted.matched}/${r.accounted.checked} to the last digit</span>`
          : `<span class="fail">${r.accounted.matched}/${r.accounted.checked}</span>`,
    ],
    ['Verification', r.verified ? passMark(true).replace('Pass', 'Verified') : `<span class="fail">✗ ${esc(r.problems.join('; '))}</span>`],
    ['Data SHA-256', `<span class="hash">${esc(r.dataHash)}</span>`],
  ],
)}
<div class="note" style="margin-top:8px">Claude Code's own output, as it printed it:</div>
<ul class="raw">${raw}</ul>
</div></div>`
}

const comparisonCard = (c: IndexComparison): string => `<div class="card entry">
<div class="shot">${shot(c.screenshot, c.page)}</div>
<div class="facts">
<div><strong><a href="${esc(c.page)}">${esc(c.labelA)} and ${esc(c.labelB)}</a></strong></div>
<div class="note">Runs <code>${esc(c.runA)}</code> and <code>${esc(c.runB)}</code> · made ${esc(c.generatedAt)}</div>
<p class="note">The page verifies both runs when it is made, and its screenshot prints both data hashes. Check them against the run cards here.</p>
</div></div>`

/** Every run and comparison in one list, newest first. */
export const renderIndex = (runs: readonly IndexRun[], comparisons: readonly IndexComparison[], generatedAt: string): string => {
  const style = `<style>
.entry { display: grid; grid-template-columns: 300px 1fr; gap: 20px; margin-bottom: 14px; }
@media (max-width: 760px) { .entry { grid-template-columns: 1fr; } }
.thumb { display: block; width: 100%; height: 220px; object-fit: cover; object-position: top; border: 1px solid var(--border); border-radius: 8px; background: var(--page); }
.thumb.empty { display: flex; align-items: center; justify-content: center; color: var(--muted); }
.facts td:first-child { color: var(--ink-2); width: 170px; }
.raw { margin: 4px 0 0; padding-left: 18px; font-size: 13px; }
a { color: var(--s1); }
</style>`

  const body = `${style}
<h1>Agent Fusion Router benchmark records</h1>
<p class="sub">Every run and comparison under <code>benchmarks/</code>, newest first, re-verified when this page was made (${esc(generatedAt)}). Click a screenshot to see it whole.</p>

<h2>Comparisons</h2>
${comparisons.length === 0 ? '<p>None yet. Make one with <code>bench compare &lt;a&gt; &lt;b&gt;</code>.</p>' : comparisons.map(comparisonCard).join('\n')}

<h2>Runs</h2>
${runs.length === 0 ? '<p>None yet. Start one with <code>bench run</code>.</p>' : runs.map(runCard).join('\n')}

<h2>How to check a figure yourself</h2>
<ol>
<li>Each run card links Claude Code's own output (<code>claude.json</code>). Its <code>total_cost_usd</code> and <code>modelUsage</code> are what Claude Code printed at the end of the session; the benchmark only saved them.</li>
<li>In the run folder, <code>sha256sum -c evidence.sha256</code> confirms no file changed since the run, and <code>sha256sum evidence.sha256</code> prints the data hash shown here and in every screenshot of that run.</li>
<li><code>node packages/cli/dist/cli.js bench verify benchmarks/results/&lt;run&gt;</code> recomputes every figure from the raw files.</li>
</ol>

<footer>Agent Fusion Router · benchmark records · ${esc(generatedAt)}</footer>`

  return page('Benchmark records', body)
}
