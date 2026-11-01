import type { UsageRecord } from '@agent-fusion-router/core'

const FILE_LINES = 2000

export type FileWrite = { path: string; text: string }

/**
 * Usage records as JSON Lines: one file per session and module load, so a hot
 * reload never reads back what an earlier load wrote. It only says what to
 * write; the hooks write it, since the engine accepts its calls only in a
 * hook's own body.
 */
export const createLog = () => {
  const part = Math.random().toString(36).slice(2, 8)
  const pending = new Map<string, string>()
  let dir: string | undefined
  let lines: string[] = []
  let fileIndex = 0
  let date: string | undefined
  let isFlushing = false
  let error: string | undefined

  return {
    get dir(): string | undefined {
      return dir
    },

    get error(): string | undefined {
      return error
    },

    setDir(path: string): void {
      dir = path.replace(/[\\/]+$/, '')
    },

    add(record: UsageRecord): void {
      if (dir === undefined) return

      const recordDate = new Date(record.ts).toISOString().slice(0, 10)
      if (recordDate !== date) {
        date = recordDate
        lines = []
        fileIndex = 0
      } else if (lines.length >= FILE_LINES) {
        lines = []
        fileIndex += 1
      }
      lines.push(JSON.stringify(record))

      pending.set(`${dir}/${date}_${record.session}_${part}-${fileIndex}.jsonl`, `${lines.join('\n')}\n`)
    },

    /**
     * Writes whatever is pending, one write at a time, so a slow write never
     * lands after a newer one. A call while another flushes returns at once:
     * the running flush picks up its record.
     */
    async flush(write: (file: FileWrite) => Promise<void>): Promise<void> {
      if (isFlushing) return
      isFlushing = true

      try {
        for (let next = first(pending); next !== undefined; next = first(pending)) {
          pending.delete(next.path)
          await write(next)
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      } finally {
        isFlushing = false
      }
    },
  }
}

const first = (files: Map<string, string>): FileWrite | undefined => {
  const entry = files.entries().next().value

  return entry === undefined ? undefined : { path: entry[0], text: entry[1] }
}

/** Parses JSON Lines, skipping lines that do not parse. */
export const parseRecords = (texts: readonly string[]): UsageRecord[] =>
  texts.flatMap(text =>
    text.split('\n').flatMap(line => {
      try {
        return line.trim() === '' ? [] : [JSON.parse(line) as UsageRecord]
      } catch {
        return []
      }
    }),
  )
