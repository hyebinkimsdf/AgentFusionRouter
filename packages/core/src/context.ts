/**
 * What a worker is handed instead of the whole conversation. A small model
 * can take a task when these five things are explicit; two workers can run
 * at once when their writable scopes do not overlap.
 */
export type TaskBrief = {
  id: string
  goal: string
  /** Files or documents to read first. */
  inputs: readonly string[]
  /** Paths the worker may change. A path ending in `/` covers a folder. */
  writable: readonly string[]
  /** Ids of tasks that must finish first. */
  dependsOn: readonly string[]
  /** Checks that decide the task is done: a command, a behaviour. */
  done: readonly string[]
}

/** What keeps a brief from being handed to a worker, as sentences. */
export const briefProblems = (brief: TaskBrief): string[] => {
  const problems: string[] = []

  if (brief.goal.trim() === '') problems.push('no goal')
  if (brief.writable.length === 0) problems.push('no writable scope: the worker could change anything')
  if (brief.done.length === 0) problems.push('no completion check: nothing can verify the result')

  return problems
}

const covers = (scope: string, path: string): boolean =>
  scope === path || (scope.endsWith('/') && path.startsWith(scope))

const overlaps = (a: string, b: string): string | undefined =>
  covers(a, b) ? b : covers(b, a) ? a : undefined

/**
 * Pairs of tasks that could run at the same time and write the same path.
 * Tasks ordered by `dependsOn`, directly or not, never run together.
 */
export const writeConflicts = (
  briefs: readonly TaskBrief[],
): { path: string; tasks: [string, string] }[] => {
  const byId = new Map(briefs.map(b => [b.id, b]))

  const dependsOn = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (seen.has(from)) return false
    seen.add(from)

    const deps = byId.get(from)?.dependsOn ?? []

    return deps.includes(to) || deps.some(d => dependsOn(d, to, seen))
  }

  const conflicts: { path: string; tasks: [string, string] }[] = []

  briefs.forEach((a, i) => {
    for (const b of briefs.slice(i + 1)) {
      if (dependsOn(a.id, b.id) || dependsOn(b.id, a.id)) continue

      for (const pa of a.writable) {
        const path = b.writable.map(pb => overlaps(pa, pb)).find(p => p !== undefined)
        if (path !== undefined) conflicts.push({ path, tasks: [a.id, b.id] })
      }
    }
  })

  return conflicts
}

/** Tasks whose dependencies are all finished and that are not finished themselves. */
export const readyTasks = (briefs: readonly TaskBrief[], finished: ReadonlySet<string>): TaskBrief[] =>
  briefs.filter(b => !finished.has(b.id) && b.dependsOn.every(d => finished.has(d)))

const list = (items: readonly string[]): string =>
  items.length === 0 ? '- (none)' : items.map(i => `- ${i}`).join('\n')

/** The brief as the prompt a worker receives. */
export const renderBrief = (brief: TaskBrief): string =>
  [
    `## Goal\n${brief.goal}`,
    `## Read first\n${list(brief.inputs)}`,
    `## You may change only\n${list(brief.writable)}`,
    `## Done when\n${list(brief.done)}`,
  ].join('\n\n')
