import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { UsageRecord } from '@agent-fusion-router/core'

/** Reads every JSON Lines file in a folder, skipping lines that do not parse. A missing folder is empty. */
export const readRecords = async (dir: string): Promise<{ records: UsageRecord[]; files: number; skipped: number }> => {
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const names = entries.filter(n => n.endsWith('.jsonl')).sort()
  const records: UsageRecord[] = []
  let skipped = 0

  for (const name of names) {
    for (const line of (await readFile(join(dir, name), 'utf8')).split('\n')) {
      if (line.trim() === '') continue
      try {
        records.push(JSON.parse(line) as UsageRecord)
      } catch {
        skipped += 1
      }
    }
  }

  return { records, files: names.length, skipped }
}
