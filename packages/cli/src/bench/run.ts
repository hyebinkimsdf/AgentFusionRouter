import { spawnSync } from 'node:child_process'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { ModelEntry, UsageRecord } from '@agent-fusion-router/core'
import { CLAUDE_MODELS, PRICES_AS_OF } from '@agent-fusion-router/core'

import { capturePage } from '../capture.ts'
import type { RunInfo } from '../html/bench.ts'
import { renderBenchReport } from '../html/bench.ts'
import { duration, usd } from '../html/page.ts'
import { readRecords } from '../logs.ts'
import { claudeAnswer, deriveResult } from './derive.ts'
import { EVIDENCE_FILE, REPORT_HASH_FILE, checkHashes, dataHash, sha256, writeEvidence, writeReportHashes } from './evidence.ts'
import { simulateAgent } from './simulate.ts'
import { summarizeBench } from './summary.ts'
import type { Arm, CheckOutcome, RunMeta, RunResult, TaskSet } from './types.ts'
import { validateTasks } from './validate.ts'
import { prepareWorkspace, removeWorkspace, runCheck, workspaceDiff } from './workspace.ts'

export type LoadedTasks = { set: TaskSet; file: string; project: string; checks: string; solutions: string }

export const loadTasks = async (file: string): Promise<LoadedTasks> => {
  const set = JSON.parse(await readFile(file, 'utf8')) as TaskSet
  const dir = dirname(resolve(file))

  return { set, file, project: join(dir, set.project), checks: join(dir, 'checks'), solutions: join(dir, 'solutions') }
}

export type RunOptions = {
  tasksFile: string
  armsFile: string
  outRoot: string
  reps: number
  simulate: boolean
  claudeBin: string
  pluginDir: string
  budgetUsd: number
  timeoutMs: number
  onlyTasks: string[]
  onlyArms: string[]
  capture: boolean
}

/** Tools the agent may run without asking: only the test runner. Edits are allowed by the permission mode. */
const ALLOWED = ['Bash(node --test:*)', 'Bash(npm test:*)', 'PowerShell(node --test:*)', 'PowerShell(npm test:*)']

/** A single session's folder name inside a run's `runs/`. */
export const runName = (taskId: string, armId: string, rep: number) => `${taskId}__${armId}__r${rep}`

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** A Windows `.cmd` shim (an npm-installed claude) only runs through the shell. */
const needsShell = (cmd: string): boolean => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)

const shell = (cmd: string, args: string[], cwd?: string): string => {
  const out = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: needsShell(cmd) })

  return out.status === 0 ? out.stdout.trim() : ''
}

/** Runs `claude -p` in the workspace. The prompt goes on stdin, everything else in a settings file, so no argument needs quoting. */
const runClaude = (
  opts: RunOptions,
  arm: Arm,
  prompt: string,
  workspace: string,
  settingsFile: string,
): { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; wallMs: number } => {
  const args = [
    '-p',
    '--output-format',
    'json',
    ...(arm.model === undefined ? [] : ['--model', arm.model]),
    '--plugin-dir',
    opts.pluginDir,
    '--settings',
    settingsFile,
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    '--max-budget-usd',
    String(opts.budgetUsd),
  ]
  const isScript = needsShell(opts.claudeBin)
  const quote = (a: string) => (isScript && /[\s"]/.test(a) ? `"${a}"` : a)
  const started = Date.now()
  const out = spawnSync(quote(opts.claudeBin), args.map(quote), {
    cwd: workspace,
    input: prompt,
    encoding: 'utf8',
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: isScript,
  })

  return {
    stdout: out.stdout ?? '',
    stderr: `${out.stderr ?? ''}${out.error ? `\n${out.error.message}` : ''}`,
    exitCode: out.status,
    timedOut: (out.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
    wallMs: Date.now() - started,
  }
}

export const runBench = async (opts: RunOptions): Promise<string> => {
  const tasks = await loadTasks(opts.tasksFile)
  const allArms = JSON.parse(await readFile(opts.armsFile, 'utf8')) as Arm[]
  const arms = opts.onlyArms.length === 0 ? allArms : allArms.filter(a => opts.onlyArms.includes(a.id))
  const taskList = opts.onlyTasks.length === 0 ? tasks.set.tasks : tasks.set.tasks.filter(t => opts.onlyTasks.includes(t.id))
  const started = new Date()
  const runId = `${stamp(started)}${opts.simulate ? '-simulated' : ''}`
  const runDir = resolve(opts.outRoot, runId)
  const logFile = join(runDir, 'run.log')

  await mkdir(join(runDir, 'runs'), { recursive: true })
  const log = async (line: string) => {
    console.log(line)
    await appendFile(logFile, `${line}\n`)
  }

  await log(`Run ${runId}${opts.simulate ? ' (SIMULATED: no model is called)' : ''}`)
  await log('Validating task checks...')
  const validation = await validateTasks(taskList, tasks)
  for (const v of validation) {
    await log(`  ${v.ok ? 'ok  ' : 'BAD '} ${v.taskId} (fails before: ${v.failsBefore}, passes with solution: ${v.passesAfter})`)
  }
  if (validation.some(v => !v.ok)) throw new Error('A task check is not sound; fix it before running models.')

  const repoRoot = process.cwd()
  const environment: Record<string, string> = {
    'Claude Code': opts.simulate ? 'not run (simulated)' : shell(opts.claudeBin, ['--version']) || 'unknown',
    Node: process.version,
    OS: `${process.platform} ${release()}`,
    'Repository commit': shell('git', ['rev-parse', 'HEAD'], repoRoot) || 'no commits yet',
    'Uncommitted changes': shell('git', ['status', '--porcelain'], repoRoot) === '' ? 'no' : 'yes',
    'Plugin bundle SHA-256': sha256(await readFile(join(opts.pluginDir, 'hooks', 'register.js'))),
  }

  await copyFile(opts.tasksFile, join(runDir, 'tasks.json'))
  await writeFile(join(runDir, 'arms.json'), `${JSON.stringify(arms, null, 2)}\n`)
  // The prices this run is estimated with, so `verify` recomputes the same figures after the catalog changes.
  await writeFile(join(runDir, 'prices.json'), `${JSON.stringify({ asOf: PRICES_AS_OF, models: CLAUDE_MODELS }, null, 2)}\n`)

  const results: RunResult[] = []
  const total = opts.reps * taskList.length * arms.length
  let n = 0

  for (let rep = 1; rep <= opts.reps; rep += 1) {
    for (const [ti, task] of taskList.entries()) {
      // Rotate the arm order per task, so no arm always runs first.
      const order = arms.map((_, i) => arms[(i + ti + rep) % arms.length] as Arm)

      for (const arm of order) {
        n += 1
        const dir = join(runDir, 'runs', runName(task.id, arm.id, rep))
        const logDir = join(dir, 'plugin-logs')
        await mkdir(logDir, { recursive: true })

        const workspace = await prepareWorkspace(tasks.project)
        const settings = {
          permissions: { allow: ALLOWED },
          pluginConfigs: Object.fromEntries(
            ['agent-fusion-router', 'agent-fusion-router@inline'].map(k => [k, { options: { ...arm.plugin, logDir } }]),
          ),
        }
        const settingsDir = await mkdtemp(join(tmpdir(), 'afr-settings-'))
        const settingsFile = join(settingsDir, 'settings.json')
        await writeFile(settingsFile, JSON.stringify(settings, null, 2))
        await writeFile(join(dir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`)
        await writeFile(join(dir, 'prompt.txt'), task.prompt)

        const startedAt = new Date().toISOString()
        const agent = opts.simulate
          ? {
              ...(await simulateAgent({ task, arm, rep, workspace, solutionsDir: tasks.solutions, logDir })),
              stderr: '',
              exitCode: 0,
              timedOut: false,
            }
          : runClaude(opts, arm, task.prompt, workspace, settingsFile)
        await rm(settingsDir, { recursive: true, force: true })

        const { numstat, patch } = workspaceDiff(workspace)
        const check = await runCheck(task, workspace, tasks.checks, claudeAnswer(agent.stdout))
        await removeWorkspace(workspace)

        const meta: RunMeta = {
          taskId: task.id,
          armId: arm.id,
          rep,
          simulated: opts.simulate,
          startedAt,
          wallMs: agent.wallMs,
          exitCode: agent.exitCode,
          timedOut: agent.timedOut,
        }
        await writeFile(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
        await writeFile(join(dir, 'claude.json'), agent.stdout)
        await writeFile(join(dir, 'claude.stderr.txt'), agent.stderr)
        await writeFile(join(dir, 'check.json'), `${JSON.stringify(check.outcome, null, 2)}\n`)
        await writeFile(join(dir, 'check.txt'), check.output)
        await writeFile(join(dir, 'diff.numstat'), numstat)
        await writeFile(join(dir, 'diff.patch'), patch)

        const result = deriveResult({
          meta,
          claudeStdout: agent.stdout,
          records: (await readRecords(logDir)).records,
          check: check.outcome,
          numstat,
          needsPlugin: arm.plugin.mode === 'route',
          prices: CLAUDE_MODELS,
        })
        await writeFile(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
        results.push(result)

        const verdict = result.valid ? (result.success ? 'pass' : 'FAIL') : `INVALID (${result.invalidReason})`
        await log(
          `[${n}/${total}] ${task.id} × ${arm.id} (rep ${rep}): ${verdict} · ${usd(result.claude?.costUsd ?? result.plugin.costUsd)} · ${duration(result.wallMs)}`,
        )
      }
    }
  }

  const run: RunInfo = {
    runId,
    simulated: opts.simulate,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    taskSet: { name: tasks.set.name, file: opts.tasksFile, sha256: sha256(await readFile(opts.tasksFile)) },
    reps: opts.reps,
    budgetUsd: opts.budgetUsd,
    environment,
    validation,
  }
  await writeFile(join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
  await writeFile(join(runDir, 'results.json'), `${JSON.stringify(summarizeBench(taskList, arms, results), null, 2)}\n`)

  // From here on nothing is written to the hashed files, run.log included.
  const hash = await writeEvidence(runDir)
  console.log(`Data SHA-256: ${hash}`)
  await reportBench(runDir, opts.capture)

  return runDir
}

type StoredRun = { run: RunInfo; tasks: TaskSet; arms: Arm[]; results: RunResult[] }

const loadRun = async (runDir: string): Promise<StoredRun> => {
  const run = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')) as RunInfo
  const tasks = JSON.parse(await readFile(join(runDir, 'tasks.json'), 'utf8')) as TaskSet
  const arms = JSON.parse(await readFile(join(runDir, 'arms.json'), 'utf8')) as Arm[]
  const results: RunResult[] = []

  for (const task of tasks.tasks) {
    for (const arm of arms) {
      for (let rep = 1; rep <= run.reps; rep += 1) {
        const file = join(runDir, 'runs', runName(task.id, arm.id, rep), 'result.json')
        const text = await readFile(file, 'utf8').catch(() => undefined)
        if (text !== undefined) results.push(JSON.parse(text) as RunResult)
      }
    }
  }

  return { run, tasks, arms, results }
}

/** Writes report.html (and report.png) for a run folder, then hashes them. */
export const reportBench = async (runDir: string, capture: boolean): Promise<void> => {
  const { run, tasks, arms, results } = await loadRun(runDir)
  const taskList = tasks.tasks.filter(t => results.some(r => r.taskId === t.id))
  const summary = summarizeBench(taskList, arms, results)
  const { prices } = await runPrices(runDir)
  const html = renderBenchReport({ run, tasks: taskList, arms, results, summary, prices, dataHash: await dataHash(runDir) })
  const htmlPath = join(runDir, 'report.html')
  await writeFile(htmlPath, html)
  console.log(`Report: ${htmlPath}`)

  if (capture) {
    try {
      const browser = await capturePage(htmlPath, join(runDir, 'report.png'))
      console.log(`Screenshot: ${join(runDir, 'report.png')} (${browser})`)
    } catch (error) {
      console.log(`No screenshot: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await writeReportHashes(runDir)
}

/**
 * The price table of runs made before `prices.json` was saved with each run
 * (up to 2026-10-30): today's catalog with cache writes at the 5-minute rate.
 */
const pricesBeforeSnapshots = (): ModelEntry[] => {
  const fiveMinute = (p: ModelEntry['price']) => ({ ...p, cacheWrite: p.input * 1.25 })

  return CLAUDE_MODELS.map(m => ({
    ...m,
    price: fiveMinute(m.price),
    ...(m.longContext ? { longContext: { ...m.longContext, price: fiveMinute(m.longContext.price) } } : {}),
  }))
}

/** The price table a run was made with: its `prices.json`, or the table used before those were saved. */
const runPrices = async (runDir: string): Promise<{ prices: ModelEntry[]; saved: boolean }> => {
  const saved = await readFile(join(runDir, 'prices.json'), 'utf8').then(
    text => (JSON.parse(text) as { models: ModelEntry[] }).models,
    () => undefined,
  )

  return { prices: saved ?? pricesBeforeSnapshots(), saved: saved !== undefined }
}

/** A run's result computed afresh from its raw files, with this release's derivation. */
const deriveFromFiles = async (
  runDir: string,
  r: Pick<RunResult, 'taskId' | 'armId' | 'rep'>,
  arms: readonly Arm[],
  prices: readonly ModelEntry[],
): Promise<RunResult> => {
  const dir = join(runDir, 'runs', runName(r.taskId, r.armId, r.rep))

  return deriveResult({
    meta: JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as RunMeta,
    claudeStdout: await readFile(join(dir, 'claude.json'), 'utf8'),
    records: (await readRecords(join(dir, 'plugin-logs'))).records as UsageRecord[],
    check: JSON.parse(await readFile(join(dir, 'check.json'), 'utf8')) as CheckOutcome,
    numstat: await readFile(join(dir, 'diff.numstat'), 'utf8'),
    needsPlugin: arms.find(a => a.id === r.armId)?.plugin.mode === 'route',
    prices,
  })
}

/** `value` cut down to the keys `shape` has, at every depth, in `shape`'s key order. */
const recordedFields = (value: unknown, shape: unknown): unknown => {
  if (shape === null || typeof shape !== 'object' || value === null || typeof value !== 'object') return value
  if (Array.isArray(shape)) return value

  const source = value as Record<string, unknown>

  return Object.fromEntries(Object.keys(shape).map(k => [k, recordedFields(source[k], (shape as Record<string, unknown>)[k])]))
}

export type RunCheck = {
  runId: string
  simulated: boolean
  dataHash: string
  runs: number
  /** Anything that fails verification. */
  problems: string[]
  /** How it was verified, where that is worth saying. */
  notes: string[]
}

/** Re-hashes every file and recomputes every figure from the raw files. */
export const checkRun = async (runDir: string): Promise<RunCheck> => {
  const problems = [...(await checkHashes(runDir, EVIDENCE_FILE)), ...(await checkHashes(runDir, REPORT_HASH_FILE))]
  const notes: string[] = []
  const { run, tasks, arms, results } = await loadRun(runDir)
  const { prices, saved } = await runPrices(runDir)
  if (!saved) {
    notes.push('No prices.json: the run predates saved price tables, so costs are recomputed with the table it was made with (cache writes at the 5-minute rate).')
  }

  for (const stored of results) {
    const recomputed = await deriveFromFiles(runDir, stored, arms, prices)
    // Compared on the fields the run recorded: a field added to results later
    // was never claimed by an older run, so it cannot contradict it.
    if (JSON.stringify(recordedFields(recomputed, stored)) !== JSON.stringify(stored)) {
      problems.push(`${runName(stored.taskId, stored.armId, stored.rep)}/result.json does not match its raw files`)
    }
  }

  const taskList = tasks.tasks.filter(t => results.some(r => r.taskId === t.id))
  const storedSummary = await readFile(join(runDir, 'results.json'), 'utf8')
  if (`${JSON.stringify(summarizeBench(taskList, arms, results), null, 2)}\n` !== storedSummary) {
    problems.push('results.json does not match the per-run results')
  }

  return {
    runId: run.runId,
    simulated: run.simulated,
    dataHash: await dataHash(runDir).catch(() => 'missing'),
    runs: results.length,
    problems,
    notes,
  }
}

export const verifyBench = async (runDir: string): Promise<boolean> => {
  const check = await checkRun(runDir)

  console.log(`Run ${check.runId}${check.simulated ? ' (simulated)' : ''}`)
  console.log(`Data SHA-256: ${check.dataHash}`)
  for (const note of check.notes) console.log(`Note: ${note}`)
  if (check.problems.length === 0) {
    console.log(`OK: ${check.runs} runs; every file matches its hash and every figure matches the raw files.`)
    return true
  }
  for (const p of check.problems) console.log(`FAIL: ${p}`)

  return false
}

/**
 * A run folder for `bench compare`: results recomputed from the raw files, so
 * an older run shows every figure this release derives, and the verification.
 */
export const loadForComparison = async (runDir: string) => {
  const { run, arms, results } = await loadRun(runDir)
  const { prices } = await runPrices(runDir)
  const recomputed = await Promise.all(results.map(r => deriveFromFiles(runDir, r, arms, prices)))

  return { run, arms, results: recomputed, prices, check: await checkRun(runDir) }
}
