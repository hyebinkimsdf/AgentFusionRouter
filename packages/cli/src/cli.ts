import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { DEFAULT_POLICY, PRICES_AS_OF, analyzeTask, formatReport, route, summarize } from '@agent-fusion-router/core'

import type { ComparisonInfo } from './bench/records.ts'
import { writeIndex } from './bench/records.ts'
import { loadForComparison, loadTasks, reportBench, runBench, verifyBench } from './bench/run.ts'
import { renderComparison } from './html/compare.ts'
import { sha256 } from './bench/evidence.ts'
import { validateTasks } from './bench/validate.ts'
import { capturePage } from './capture.ts'
import { renderUsageReport } from './html/usage.ts'
import { readRecords } from './logs.ts'

const USAGE = `agent-fusion-router <command> [options]

Usage logs
  report                Summarize what the plugin recorded
    --dir <path>          Log folder (default ~/.agent-fusion-router/logs)
    --since <age>         Only records newer than this: 7d, 12h, 30m
    --json                Print the summary as JSON
    --html <file>         Also write the report as a web page
    --png <file>          With --html: also save a full-page screenshot
  explain <task>        Show how the router classifies a task
    --model <id>          The session model to route from (default claude-opus-5-5)
  doctor                Check the log folder and what it holds

Benchmarks (run from the repository root)
  bench validate        Check every task's hidden check: fails before, passes with the solution
    --tasks <file>        Task set (default examples/shop/tasks.json)
  bench run             Run every task in every arm, then write the report and evidence
    --tasks <file>        Task set (default examples/shop/tasks.json)
    --arms <file>         Arms to compare (default benchmarks/arms.json)
    --reps <n>            Repetitions per task and arm (default 1)
    --task <id>           Only this task (repeatable)
    --arm <id>            Only this arm (repeatable)
    --budget <usd>        Spending cap per run, passed to claude --max-budget-usd (default 1)
    --timeout <minutes>   Time limit per run (default 15)
    --claude <path>       The claude executable (default: claude, or CLAUDE_BIN)
    --plugin-dir <path>   The plugin to load (default plugins/claude/agent-fusion-router)
    --out <dir>           Where run folders go (default benchmarks/results)
    --simulate            Call no model: exercise the pipeline with invented numbers
    --no-png              Skip the screenshot
  bench report <dir>    Rewrite a run's report.html and report.png
  bench verify <dir>    Re-hash every file and recompute every figure from the raw files
  bench compare <a> <b> Two runs side by side, as a page and a screenshot, each verified
    --label-a <text>      Name for the first run (default: its run id)
    --label-b <text>      Name for the second run
    --out <dir>           Where to write it (default benchmarks/comparisons/<a>_vs_<b>)
  bench index           List every run and comparison in benchmarks/index.html, re-verified
    --include-simulated   Also list simulated runs
  (run and compare refresh benchmarks/index.html themselves)
`

const DEFAULT_DIR = join(homedir(), '.agent-fusion-router', 'logs')

const parseAge = (age: string): number => {
  const match = /^(\d+)([dhm])$/.exec(age)
  if (!match) throw new Error(`--since takes a number and d, h or m, like 7d: got "${age}"`)

  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[match[2] as 'd' | 'h' | 'm']

  return Number(match[1]) * unit
}

const report = async (args: string[]): Promise<void> => {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      since: { type: 'string' },
      json: { type: 'boolean' },
      html: { type: 'string' },
      png: { type: 'string' },
    },
  })
  const dir = values.dir ?? DEFAULT_DIR
  const { records } = await readRecords(dir)
  const cutoff = values.since === undefined ? 0 : Date.now() - parseAge(values.since)
  const kept = records.filter(r => r.ts >= cutoff)
  const summary = summarize(kept)

  console.log(values.json ? JSON.stringify({ pricesAsOf: PRICES_AS_OF, ...summary }, null, 2) : formatReport(summary))

  if (values.html !== undefined) {
    const html = renderUsageReport(summary, {
      dir,
      generatedAt: new Date().toISOString(),
      dataHash: sha256(kept.map(r => JSON.stringify(r)).join('\n')),
    })
    await writeFile(values.html, html)
    console.log(`\nReport: ${resolve(values.html)}`)

    if (values.png !== undefined) {
      await capturePage(resolve(values.html), resolve(values.png))
      console.log(`Screenshot: ${resolve(values.png)}`)
    }
  }
}

const explain = (args: string[]): void => {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { model: { type: 'string' } } })
  const task = positionals.join(' ')
  if (task === '') throw new Error('explain needs a task, in quotes')

  const analysis = analyzeTask(task)
  const decision = route(
    { analysis, currentModel: values.model ?? 'claude-opus-5-5', currentEffort: 'medium' },
    { ...DEFAULT_POLICY, mode: 'route' },
  )

  console.log(
    [
      `Kind        ${analysis.kind}`,
      `Tier        ${decision.tier} (analyzer: ${analysis.tier}, confidence ${analysis.confidence})`,
      `Signals     ${analysis.signals.join(', ') || 'none'}`,
      `Model       ${decision.model ?? 'unchanged'}`,
      `Effort      ${decision.effort ?? 'unchanged'}`,
      `Reasons     ${decision.reasons.join(', ')}`,
    ].join('\n'),
  )
}

const doctor = async (args: string[]): Promise<void> => {
  const { values } = parseArgs({ args, options: { dir: { type: 'string' } } })
  const dir = values.dir ?? DEFAULT_DIR
  const exists = await stat(dir).then(s => s.isDirectory(), () => false)

  if (!exists) {
    console.log(`No log folder at ${dir}.`)
    console.log('The Claude Code plugin creates it on the first model request after it is installed.')
    return
  }

  const { records, files, skipped } = await readRecords(dir)
  const sessions = new Set(records.map(r => r.session)).size
  const last = records.reduce((max, r) => Math.max(max, r.ts), 0)

  console.log(`Log folder   ${dir}`)
  console.log(`Files        ${files} (${records.length} records, ${sessions} sessions)`)
  console.log(`Last record  ${last === 0 ? 'none' : new Date(last).toISOString()}`)
  if (skipped > 0) console.log(`Unreadable   ${skipped} lines skipped`)
  console.log(`Prices as of ${PRICES_AS_OF}`)
}

const bench = async (args: string[]): Promise<void> => {
  const [sub, ...rest] = args
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      tasks: { type: 'string', default: 'examples/shop/tasks.json' },
      arms: { type: 'string', default: 'benchmarks/arms.json' },
      reps: { type: 'string', default: '1' },
      task: { type: 'string', multiple: true, default: [] },
      arm: { type: 'string', multiple: true, default: [] },
      budget: { type: 'string', default: '1' },
      timeout: { type: 'string', default: '15' },
      claude: { type: 'string' },
      'plugin-dir': { type: 'string', default: 'plugins/claude/agent-fusion-router' },
      out: { type: 'string' },
      simulate: { type: 'boolean', default: false },
      'no-png': { type: 'boolean', default: false },
      'label-a': { type: 'string' },
      'label-b': { type: 'string' },
      'include-simulated': { type: 'boolean', default: false },
    },
  })
  const refreshIndex = async () => console.log(`Index: ${resolve(await writeIndex('benchmarks', values['include-simulated']))}`)

  switch (sub) {
    case 'validate': {
      const tasks = await loadTasks(values.tasks)
      const rows = await validateTasks(tasks.set.tasks, tasks)
      for (const v of rows) {
        console.log(`${v.ok ? 'ok  ' : 'BAD '} ${v.taskId.padEnd(22)} fails before: ${v.failsBefore ? 'yes' : 'NO'} · passes with solution: ${v.passesAfter ? 'yes' : 'NO'}`)
      }
      if (rows.some(v => !v.ok)) process.exitCode = 1
      return
    }
    case 'run': {
      const runDir = await runBench({
        tasksFile: values.tasks,
        armsFile: values.arms,
        outRoot: values.out ?? 'benchmarks/results',
        reps: Math.max(1, Number(values.reps) || 1),
        simulate: values.simulate,
        claudeBin: values.claude ?? process.env.CLAUDE_BIN ?? 'claude',
        pluginDir: resolve(values['plugin-dir']),
        budgetUsd: Number(values.budget) || 1,
        timeoutMs: (Number(values.timeout) || 15) * 60_000,
        onlyTasks: values.task,
        onlyArms: values.arm,
        capture: !values['no-png'],
      })
      console.log(`\nRun folder: ${runDir}`)
      if (values.out === undefined) await refreshIndex()
      return
    }
    case 'index': {
      await refreshIndex()
      return
    }
    case 'report': {
      const dir = positionals[0]
      if (dir === undefined) throw new Error('bench report needs a run folder')
      await reportBench(resolve(dir), !values['no-png'])
      return
    }
    case 'verify': {
      const dir = positionals[0]
      if (dir === undefined) throw new Error('bench verify needs a run folder')
      if (!(await verifyBench(resolve(dir)))) process.exitCode = 1
      return
    }
    case 'compare': {
      const [dirA, dirB] = positionals
      if (dirA === undefined || dirB === undefined) throw new Error('bench compare needs two run folders')

      const [a, b] = await Promise.all([loadForComparison(resolve(dirA)), loadForComparison(resolve(dirB))])
      const out = resolve(values.out ?? join('benchmarks', 'comparisons', `${a.run.runId}_vs_${b.run.runId}`))
      await mkdir(out, { recursive: true })

      const info: ComparisonInfo = {
        labelA: values['label-a'] ?? a.run.runId,
        labelB: values['label-b'] ?? b.run.runId,
        runA: a.run.runId,
        runB: b.run.runId,
        generatedAt: new Date().toISOString(),
      }
      const html = renderComparison({ label: info.labelA, ...a }, { label: info.labelB, ...b }, info.generatedAt)
      const htmlPath = join(out, 'comparison.html')
      const pngPath = join(out, 'comparison.png')
      await writeFile(join(out, 'comparison.json'), `${JSON.stringify(info, null, 2)}\n`)
      await writeFile(htmlPath, html)
      console.log(`Comparison: ${htmlPath}`)
      if (!values['no-png']) {
        await capturePage(htmlPath, pngPath)
        console.log(`Screenshot: ${pngPath}`)
      }

      const files = [join(out, 'comparison.json'), htmlPath, ...(values['no-png'] ? [] : [pngPath])]
      const hashes = await Promise.all(files.map(async f => `${sha256(await readFile(f))}  ${basename(f)}`))
      await writeFile(join(out, 'comparison.sha256'), `${hashes.join('\n')}\n`)
      for (const c of [a.check, b.check]) {
        console.log(`${c.runId}: ${c.problems.length === 0 ? 'verified' : `NOT verified (${c.problems.length} problems)`}`)
      }
      if (values.out === undefined) await refreshIndex()
      return
    }
    default:
      throw new Error(`bench needs validate, run, report, verify, compare or index\n\n${USAGE}`)
  }
}

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case 'report':
      return report(rest)
    case 'explain':
      return explain(rest)
    case 'doctor':
      return doctor(rest)
    case 'bench':
      return bench(rest)
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE)
      return
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
