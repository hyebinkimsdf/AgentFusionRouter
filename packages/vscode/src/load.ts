// Reads the Claude Code plugin's logs and Codex's session records for a
// period, keeping what it parsed: a file is read again only when its size or
// modification time changed, and a file last written before the period starts
// is not opened at all. No `vscode` import, so it runs and is tested under
// plain Node.

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CodexCostSummary, CodexLedger, CodexUsageSummary, ParsedSession } from '@agent-fusion-router/codex-adapter'
import { codexHome, codexPolicyWithStandard, combineSessions, findSessionFiles, parseSession, sessionName, simulateCodexRouting, summarizeCodexLedger } from '@agent-fusion-router/codex-adapter'
import type { Summary, UsageRecord } from '@agent-fusion-router/core'
import { summarize } from '@agent-fusion-router/core'

import type { Figures, Period } from './figures.ts'
import { periodStart, toFigures } from './figures.ts'

export type Settings = {
  period: Period
  /** Empty: ~/.agent-fusion-router/logs, the plugin's default. */
  claudeLogDir: string
  /** Empty: CODEX_HOME, else ~/.codex. */
  codexHome: string
  /** Empty: each turn keeps its own model for ordinary work, the router's default. */
  codexStandardModel: string
}

export type Loaded = {
  figures: Figures
  from: number
  claudeDir: string
  claude: Summary
  codexHome: string
  /** Absent when Codex has no session records written in the period. */
  codex?: { ledger: CodexLedger; usage: CodexUsageSummary; costs: CodexCostSummary }
}

type Stamp = { mtimeMs: number; size: number }

/** Keeps each file's parse until the file changes. `reads` counts the files actually read. */
export const fileCache = <T>(parse: (text: string, path: string) => T) => {
  const kept = new Map<string, Stamp & { value: T }>()
  let reads = 0

  return {
    get reads() {
      return reads
    },
    async get(path: string, stamp: Stamp): Promise<T> {
      const hit = kept.get(path)
      if (hit !== undefined && hit.mtimeMs === stamp.mtimeMs && hit.size === stamp.size) return hit.value
      reads += 1
      const value = parse(await readFile(path, 'utf8'), path)
      kept.set(path, { ...stamp, value })
      return value
    },
    /** Forgets every file not in `paths`. */
    retain(paths: ReadonlySet<string>): void {
      for (const path of kept.keys()) if (!paths.has(path)) kept.delete(path)
    },
  }
}

/** The plugin's JSON Lines, skipping lines that do not parse, as the CLI reads them. */
const parseRecords = (text: string): UsageRecord[] =>
  text.split('\n').flatMap(line => {
    if (line.trim() === '') return []
    try {
      return [JSON.parse(line) as UsageRecord]
    } catch {
      return []
    }
  })

/** `paths` with their stamps, keeping those written at or after `from`. */
const writtenSince = async (paths: readonly string[], from: number): Promise<[string, Stamp][]> => {
  const stamped = await Promise.all(paths.map(async p => [p, await stat(p).catch(() => undefined)] as const))
  return stamped.flatMap(([p, s]) => (s === undefined || s.mtimeMs < from ? [] : [[p, { mtimeMs: s.mtimeMs, size: s.size }]]))
}

/** One loader per editor session: its caches live as long as it does. */
export const createLoader = () => {
  const claudeFiles = fileCache(parseRecords)
  const codexFiles = new Map<string, ReturnType<typeof fileCache<ParsedSession>>>()

  const loadClaude = async (dir: string, from: number): Promise<Summary> => {
    const names = (await readdir(dir).catch(() => [] as string[])).filter(n => n.endsWith('.jsonl')).sort()
    const files = await writtenSince(names.map(n => join(dir, n)), from)
    claudeFiles.retain(new Set(files.map(([p]) => p)))
    const records = (await Promise.all(files.map(([p, s]) => claudeFiles.get(p, s)))).flat()

    return summarize(records.filter(r => r.ts >= from))
  }

  const loadCodex = async (home: string, from: number, standardModel: string): Promise<Loaded['codex']> => {
    let cache = codexFiles.get(home)
    if (cache === undefined) {
      cache = fileCache((text, path) => parseSession(text, sessionName(home, path)))
      codexFiles.set(home, cache)
    }
    const files = await writtenSince(await findSessionFiles(home), from)
    if (files.length === 0) return undefined
    cache.retain(new Set(files.map(([p]) => p)))

    const ledger = combineSessions(home, await Promise.all(files.map(([p, s]) => (cache as NonNullable<typeof cache>).get(p, s))))
    const entries = ledger.entries.filter(e => e.timestamp !== undefined && Date.parse(e.timestamp) >= from)
    const policy = standardModel === '' ? undefined : codexPolicyWithStandard(standardModel)

    return { ledger, usage: summarizeCodexLedger(ledger), costs: simulateCodexRouting(entries, ledger.analyses, policy) }
  }

  return {
    claudeFiles,
    codexFiles,
    async load(settings: Settings, now: Date): Promise<Loaded> {
      const from = periodStart(settings.period, now)
      const claudeDir = settings.claudeLogDir || join(homedir(), '.agent-fusion-router', 'logs')
      const home = settings.codexHome || codexHome()
      const [claude, codex] = await Promise.all([loadClaude(claudeDir, from), loadCodex(home, from, settings.codexStandardModel.trim())])

      return {
        figures: toFigures(settings.period, claude, codex?.costs),
        from,
        claudeDir,
        claude,
        codexHome: home,
        ...(codex === undefined ? {} : { codex }),
      }
    },
  }
}
