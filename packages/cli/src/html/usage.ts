import type { Summary } from '@agent-fusion-router/core'
import { PRICES_AS_OF } from '@agent-fusion-router/core'

import { compact, esc, page, table, tile, usd } from './page.ts'

const day = (ts: number | undefined): string => (ts === undefined ? '—' : new Date(ts).toISOString().slice(0, 10))

const counts = (record: Partial<Record<string, number>>): string =>
  Object.entries(record)
    .map(([k, v]) => `${esc(k)} ${v}`)
    .join(' · ') || 'none'

/** The usage report as a page: what `report` prints, plus the generation time and source. */
export const renderUsageReport = (s: Summary, source: { dir: string; generatedAt: string; dataHash: string }): string => {
  const models = table(
    ['Model', 'Requests', 'Input', 'Output', 'Cache read', 'Cache write', 'Estimated cost'],
    s.byModel.map(r => [
      `<code>${esc(r.model)}</code>`,
      String(r.requests),
      compact(r.tokens.input),
      compact(r.tokens.output),
      compact(r.tokens.cacheRead),
      compact(r.tokens.cacheWrite),
      r.costUsd === undefined ? 'n/a' : usd(r.costUsd),
    ]),
    [1, 2, 3, 4, 5, 6],
  )

  const body = `<h1>Agent Fusion Router usage</h1>
<p class="sub">${day(s.from)} to ${day(s.to)} · from <code>${esc(source.dir)}</code></p>
<div class="card"><div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
${tile('Sessions', String(s.sessions))}
${tile('Turns', String(s.turns))}
${tile('Requests', String(s.requests))}
${tile('Estimated cost', usd(s.costUsd))}
${tile('Routed requests', String(s.routedRequests), s.wouldRouteRequests > 0 ? `${s.wouldRouteRequests} more in observe mode` : '')}
${tile('Escalated turns', String(s.escalatedTurns))}
</div></div>
<h2>By model</h2>
${models}
<h2>Turns</h2>
${table(['', ''], [
  ['By tier', counts(s.turnsByTier)],
  ['By outcome', counts(s.turnsByOutcome)],
  ['Subagents started', `${s.spawns} (${s.routedSpawns} routed)`],
])}
${s.unpricedModels.length > 0 ? `<p class="note">No price for ${esc(s.unpricedModels.join(', '))}: left out of the totals.</p>` : ''}
<p class="note">Estimates use Anthropic list prices as of ${PRICES_AS_OF}; they are not a bill. On a Claude subscription, usage counts against plan limits instead.</p>
<footer>Agent Fusion Router · generated ${esc(source.generatedAt)} · log data SHA-256 ${esc(source.dataHash)}</footer>`

  return page('Agent Fusion Router usage', body)
}
