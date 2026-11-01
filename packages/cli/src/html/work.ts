import type { Arm, RunResult, Task } from '../bench/types.ts'
import type { RunInfo } from './bench.ts'
import { SERIES, duration, esc, page, passMark, swatch, usd } from './page.ts'

/** What one session produced: its final answer and its change to the project. */
export type Work = { taskId: string; armId: string; rep: number; answer: string; patch: string }

const MAX_PATCH_LINES = 160
const MAX_ANSWER_CHARS = 1200

/** A unified diff with added and removed lines marked, cut to a readable length. */
const renderPatch = (patch: string, fullPath: string): string => {
  if (patch.trim() === '') return '<p class="note">No change to the project.</p>'

  const lines = patch.replace(/\n$/, '').split('\n')
  const shown = lines.slice(0, MAX_PATCH_LINES).map(line => {
    const kind = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')
      ? 'meta'
      : line.startsWith('+')
        ? 'add'
        : line.startsWith('-')
          ? 'del'
          : line.startsWith('@@')
            ? 'hunk'
            : ''

    return `<span class="${kind}">${esc(line)}</span>`
  })
  const cut = lines.length > MAX_PATCH_LINES
    ? `\n<span class="meta">… ${lines.length - MAX_PATCH_LINES} more lines in ${esc(fullPath)}</span>`
    : ''

  return `<pre class="diff">${shown.join('\n')}${cut}</pre>`
}

const renderAnswer = (answer: string): string => {
  const text = answer.length > MAX_ANSWER_CHARS ? `${answer.slice(0, MAX_ANSWER_CHARS)} …` : answer

  return text.trim() === '' ? '<p class="note">No final answer.</p>' : `<pre class="answer">${esc(text)}</pre>`
}

const modelNames = (r: RunResult): string =>
  r.plugin.models.map(m => m.replace(/^claude-/, '')).join(' → ') || 'unknown'

/** Every session's work, task by task, the arms side by side: what each model actually changed. */
export const renderWork = (input: {
  run: RunInfo
  tasks: readonly Task[]
  arms: readonly Arm[]
  results: readonly RunResult[]
  works: readonly Work[]
  dataHash: string
}): string => {
  const { run, tasks, arms, results, works } = input
  const color = (armId: string) => SERIES[arms.findIndex(a => a.id === armId) % SERIES.length] ?? SERIES[0]

  const sections = tasks.map(task => {
    const cards = results
      .filter(r => r.taskId === task.id)
      .map(r => {
        const arm = arms.find(a => a.id === r.armId)
        const work = works.find(w => w.taskId === r.taskId && w.armId === r.armId && w.rep === r.rep)
        const folder = `runs/${r.taskId}__${r.armId}__r${r.rep}`

        return `<div class="card work">
<div class="head"><strong>${swatch(color(r.armId))}${esc(arm?.label ?? r.armId)}</strong>${run.reps > 1 ? ` · rep ${r.rep}` : ''} · ${!r.valid ? '<span class="fail">Invalid</span>' : r.timedOut ? '<span class="fail">✗ Timed out</span>' : passMark(r.success)}</div>
<div class="note">Model: <strong>${esc(modelNames(r))}</strong> · ${usd(r.claude?.costUsd)} · ${duration(r.wallMs)} · ${r.claude?.numTurns ?? '—'} turns · +${r.diff.added} / −${r.diff.removed} lines</div>
<h4>Change</h4>
${renderPatch(work?.patch ?? '', `${folder}/diff.patch`)}
<h4>Final answer</h4>
${renderAnswer(work?.answer ?? '')}
</div>`
      })
      .join('\n')

    return `<h2><code>${esc(task.id)}</code> <span class="sub">${esc(task.kind)} · expected ${esc(task.expectedTier)}</span></h2>
<p class="prompt">${esc(task.prompt)}</p>
<div class="works">${cards}</div>`
  })

  const style = `<style>
.works { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); align-items: start; }
.work h4 { margin: 12px 0 6px; font-size: 12px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .04em; }
.work .head { margin-bottom: 2px; }
.prompt { background: var(--surface); border-left: 3px solid var(--axis); padding: 8px 12px; color: var(--ink-2); }
pre.diff, pre.answer { margin: 0; padding: 10px 12px; font-size: 11.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-all; }
pre.diff .add { color: var(--good-text); background: rgba(12,163,12,.08); display: inline-block; width: 100%; }
pre.diff .del { color: var(--critical); background: rgba(208,59,59,.08); display: inline-block; width: 100%; }
pre.diff .hunk { color: var(--s1); }
pre.diff .meta { color: var(--muted); }
</style>`

  const body = `${style}
<h1>Work produced</h1>
<p class="sub">Run <code>${esc(run.runId)}</code>${run.simulated ? ' · SIMULATED' : ''} · what each session changed in the project and answered, task by task, with the model that did it. Pass or fail comes from the hidden tests, run after the session ended.</p>
${run.simulated ? '<div class="banner" role="note"><strong>⚠ Simulated run: no model was called</strong>The changes below are the reference solutions, applied by the simulator.</div>' : ''}
${sections.join('\n')}
<footer>Agent Fusion Router · work produced in run ${esc(run.runId)} · data SHA-256 ${esc(input.dataHash)}</footer>`

  return page(`Work produced in ${run.runId}`, body)
}
