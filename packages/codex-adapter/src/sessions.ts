import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'

import type { FileLedger, LedgerEntry } from './ledger.ts'
import { parseSessionLedger } from './ledger.ts'

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
}

/**
 * Reads every session record under Codex's home into one ledger. Files are
 * only read. Entries name their file relative to the home, so no absolute
 * path (and no user name) is kept.
 */
export const readCodexLedger = async (home: string = codexHome()): Promise<CodexLedger> => {
  const files: FileLedger[] = []
  const entries: LedgerEntry[] = []
  const seen = new Set<string>()
  let crossFileDuplicates = 0

  for (const path of await findSessionFiles(home)) {
    const ledger = parseSessionLedger(await readFile(path, 'utf8'), relative(home, path).split(sep).join('/'))
    files.push(ledger)

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

  return { home, files, entries, crossFileDuplicates }
}
