import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CheckOutcome, Task } from './types.ts'

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const git = (cwd: string, args: string[]): string => {
  const out = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@localhost', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
  })
  if (out.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${out.stderr}`)

  return out.stdout
}

/** A fresh copy of the project in the system temp folder, committed so the agent's changes can be diffed. */
export const prepareWorkspace = async (projectDir: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'afr-bench-'))
  await cp(projectDir, dir, { recursive: true })
  git(dir, ['init', '-q'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'baseline'])

  return dir
}

/** Everything the agent changed since the baseline, as `--numstat` and as a patch. */
export const workspaceDiff = (dir: string): { numstat: string; patch: string } => {
  git(dir, ['add', '-A'])

  return { numstat: git(dir, ['diff', '--cached', '--numstat']), patch: git(dir, ['diff', '--cached']) }
}

export const removeWorkspace = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true }).catch(() => {})

/** Copies a folder's files over the workspace, keeping relative paths. */
export const overlay = async (fromDir: string, toDir: string): Promise<void> => {
  if (await exists(fromDir)) await cp(fromDir, toDir, { recursive: true, force: true })
}

/**
 * The independent check: copies the task's hidden tests into `test/hidden/`,
 * runs the whole test suite, and matches the answer when the task asks a question.
 */
export const runCheck = async (
  task: Task,
  workspace: string,
  checksDir: string,
  answer: string,
): Promise<{ outcome: CheckOutcome; output: string }> => {
  await overlay(join(checksDir, task.id), join(workspace, 'test', 'hidden'))

  const tests = spawnSync(process.execPath, ['--test'], { cwd: workspace, encoding: 'utf8', timeout: 120_000 })
  const answerOk = task.answerIncludes === undefined ? undefined : answerMatches(answer, task.answerIncludes)

  return {
    outcome: {
      testsPassed: tests.status === 0,
      testsExitCode: tests.status,
      ...(answerOk === undefined ? {} : { answerOk }),
    },
    output: `${tests.stdout ?? ''}${tests.stderr ?? ''}`,
  }
}

/**
 * Whether an answer contains every expected string. Paths compare with `/`:
 * an agent on Windows may answer `src\pricing.js`, which is just as right.
 */
export const answerMatches = (answer: string, expected: readonly string[]): boolean => {
  const normalized = answer.replace(/\\/g, '/')

  return expected.every(s => normalized.includes(s.replace(/\\/g, '/')))
}

/** A task's reference answer, for tasks that ask a question. */
export const referenceAnswer = (solutionsDir: string, task: Task): Promise<string> =>
  readFile(join(solutionsDir, task.id, 'answer.txt'), 'utf8').catch(() => '')
