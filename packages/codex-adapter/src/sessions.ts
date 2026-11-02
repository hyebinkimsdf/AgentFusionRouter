import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'

import type { Analysis } from '@agent-fusion-router/core'

import type { FileLedger, LedgerEntry } from './ledger.ts'
import { parseSessionLedger } from './ledger.ts'
import { analyzeTurns } from './turns.ts'

/** Codex's data folder: CODEX_HOME, else ~/.codex. */
export const codexHome = (env: NodeJS.ProcessEnv = process.env): string => env.CODEX_HOME || join(homedir(), '.codex')

/** The folders under Codex's home that hold session records. */
const SESSION_DIRS = ['sessions', 'archived_sessions']

const walk = async (dir: string): Promise<string[]> => {
  const found = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    found.map(e => (e.isDirectory() ? walk(join(dir, e.name)) : Promise.resolve(/^rollout-.*\.jsonl$/.test(e.name) ? [join(dir, e.name)] : []))),
  )
  return nested.flat()
}

/** Every session record (`rollout-*.jsonl`) under Codex's home, oldest first: the names start with their date. */
export const findSessionFiles = async (home: string): Promise<string[]> => {
  const files = (await Promise.all(SESSION_DIRS.map(d => walk(join(home, d))))).flat()
  return files.sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b))
}

export type CodexLedger = {
  home: string
  /** Each file's own ledger and reconciliation, untouched by the other files. */
  files: FileLedger[]
  /** Every entry once: a request id already seen in an earlier file is dropped. */
  entries: LedgerEntry[]
  /** Records dropped because an earlier file holds the same request id. */
  crossFileDuplicates: number
  /** The router's analysis of each turn's prompt, by file, then turn id. The prompts themselves are not kept. */
  analyses: Map<string, Map<string, Analysis>>
}

/** One session record, read: its ledger and its turns' analyses. */
export type ParsedSession = { ledger: FileLedger; analyses: Map<string, Analysis> }

/** Parses one session record's text. `file` names it, relative to Codex's home. */
export const parseSession = (text: string, file: string): ParsedSession => ({ ledger: parseSessionLedger(text, file), analyses: analyzeTurns(text) })

/** A session file's name relative to Codex's home, with forward slashes: no absolute path, no user name. */
export const sessionName = (home: string, path: string): string => relative(home, path).split(sep).join('/')

/** Joins parsed sessions, oldest first, into one ledger: a request id already seen in an earlier file is dropped. */
export const combineSessions = (home: string, sessions: readonly ParsedSession[]): CodexLedger => {
  const entries: LedgerEntry[] = []
  const seen = new Set<string>()
  let crossFileDuplicates = 0

  for (const { ledger } of sessions) {
    for (const entry of ledger.entries) {
      if (entry.requestId !== undefined) {
        if (seen.has(entry.requestId)) {
          crossFileDuplicates += 1
          continue
        }
        seen.add(entry.requestId)
      }
      entries.push(entry)
    }
  }

  return {
    home,
    files: sessions.map(s => s.ledger),
    entries,
    crossFileDuplicates,
    analyses: new Map(sessions.map(s => [s.ledger.file, s.analyses])),
  }
}

/** Reads every session record under Codex's home into one ledger. Files are only read. */
export const readCodexLedger = async (home: string = codexHome()): Promise<CodexLedger> => {
  const sessions: ParsedSession[] = []
  for (const path of await findSessionFiles(home)) sessions.push(parseSession(await readFile(path, 'utf8'), sessionName(home, path)))

  return combineSessions(home, sessions)
}
