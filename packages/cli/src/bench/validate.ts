import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { Task } from './types.ts'
import { overlay, prepareWorkspace, referenceAnswer, removeWorkspace, runCheck } from './workspace.ts'

export type TaskValidation = {
  taskId: string
  /** The check fails on the untouched project: there is something to do. */
  failsBefore: boolean
  /** The check passes with the reference solution: the task can be done and judged. */
  passesAfter: boolean
  ok: boolean
}

/** Proves each task's check is sound before any model is judged by it. */
export const validateTasks = async (
  tasks: readonly Task[],
  dirs: { project: string; checks: string; solutions: string },
): Promise<TaskValidation[]> => {
  const rows: TaskValidation[] = []

  for (const task of tasks) {
    const before = await prepareWorkspace(dirs.project)
    const failsBefore = !isSuccess((await runCheck(task, before, dirs.checks, '')).outcome)
    await removeWorkspace(before)

    const after = await prepareWorkspace(dirs.project)
    const solution = join(dirs.solutions, task.id)
    await overlay(solution, after)
    await rm(join(after, 'answer.txt'), { force: true })
    const answer = await referenceAnswer(dirs.solutions, task)
    const passesAfter = isSuccess((await runCheck(task, after, dirs.checks, answer)).outcome)
    await removeWorkspace(after)

    rows.push({ taskId: task.id, failsBefore, passesAfter, ok: failsBefore && passesAfter })
  }

  return rows
}

const isSuccess = (o: { testsPassed: boolean; answerOk?: boolean }): boolean => o.testsPassed && o.answerOk !== false
