import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { IndexComparison, IndexRun } from '../html/index-page.ts'
import { renderIndex } from '../html/index-page.ts'
import { loadForComparison, runName } from './run.ts'
import { unaccountedUsd } from './summary.ts'

/** What `bench compare` leaves beside its page, so the index can name it. */
export type ComparisonInfo = { labelA: string; labelB: string; runA: string; runB: string; generatedAt: string }

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const folders = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse()

/**
 * Writes `<root>/index.html`: every run and comparison under `root`, newest
 * first, each run re-verified now. Simulated runs are left out unless asked.
 */
export const writeIndex = async (root: string, includeSimulated = false): Promise<string> => {
  const runs: IndexRun[] = []

  for (const name of await folders(join(root, 'results'))) {
    const dir = join(root, 'results', name)
    if (!(await exists(join(dir, 'run.json')))) continue

    const c = await loadForComparison(dir)
    if (c.run.simulated && !includeSimulated) continue

    const unaccounted = c.results.flatMap(r => {
      const u = unaccountedUsd(r, c.prices)
      return u === undefined ? [] : [u]
    })

    runs.push({
      runId: c.run.runId,
      startedAt: c.run.startedAt,
      simulated: c.run.simulated,
      tasks: new Set(c.results.map(r => r.taskId)).size,
      arms: c.arms.map(a => a.label),
      reps: c.run.reps,
      runs: c.results.length,
      successes: c.results.filter(r => r.valid && r.success).length,
      claudeCostUsd: c.results.reduce((n, r) => n + (r.claude?.costUsd ?? 0), 0),
      accounted: { matched: unaccounted.filter(u => Math.abs(u) < 5e-9).length, checked: unaccounted.length },
      verified: c.check.problems.length === 0,
      problems: c.check.problems,
      dataHash: c.check.dataHash,
      report: `results/${name}/report.html`,
      ...((await exists(join(dir, 'report.png'))) ? { screenshot: `results/${name}/report.png` } : {}),
      raw: c.results.map(r => ({
        label: `${r.taskId} · ${r.armId} · rep ${r.rep}`,
        path: `results/${name}/runs/${runName(r.taskId, r.armId, r.rep)}/claude.json`,
        costUsd: r.claude?.costUsd,
      })),
    })
  }

  const comparisons: IndexComparison[] = []

  for (const name of await folders(join(root, 'comparisons'))) {
    const dir = join(root, 'comparisons', name)
    const info = await readFile(join(dir, 'comparison.json'), 'utf8').then(
      text => JSON.parse(text) as ComparisonInfo,
      () => undefined,
    )
    if (info === undefined) continue

    comparisons.push({
      name,
      ...info,
      page: `comparisons/${name}/comparison.html`,
      ...((await exists(join(dir, 'comparison.png'))) ? { screenshot: `comparisons/${name}/comparison.png` } : {}),
    })
  }

  const path = join(root, 'index.html')
  await writeFile(path, renderIndex(runs, comparisons, new Date().toISOString()))

  return path
}
