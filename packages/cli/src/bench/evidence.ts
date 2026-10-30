import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

// A run folder's raw files are listed with their SHA-256 in `evidence.sha256`,
// in the format `sha256sum -c` reads. The hash of that list is the run's data
// hash: the report and its screenshot print it, so a picture can be matched
// to the files it was made from.

export const EVIDENCE_FILE = 'evidence.sha256'
export const REPORT_HASH_FILE = 'report.sha256'
const REPORT_FILES = ['report.html', 'report.png', 'work.html', 'work.png']
const NOT_EVIDENCE = new Set([EVIDENCE_FILE, REPORT_HASH_FILE, ...REPORT_FILES])

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

const listFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })

  return entries
    .filter(e => e.isFile())
    .map(e => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort()
}

const hashList = async (dir: string, files: readonly string[]): Promise<string> => {
  const lines = await Promise.all(files.map(async f => `${sha256(await readFile(join(dir, f)))}  ${f}`))

  return `${lines.join('\n')}\n`
}

/** Writes `evidence.sha256` over every raw file and returns the data hash. */
export const writeEvidence = async (runDir: string): Promise<string> => {
  const files = (await listFiles(runDir)).filter(f => !NOT_EVIDENCE.has(f))
  const text = await hashList(runDir, files)
  await writeFile(join(runDir, EVIDENCE_FILE), text)

  return sha256(text)
}

export const dataHash = async (runDir: string): Promise<string> => sha256(await readFile(join(runDir, EVIDENCE_FILE)))

/** Hashes the report and its screenshot, which are made after the data hash. */
export const writeReportHashes = async (runDir: string): Promise<void> => {
  const present = (await listFiles(runDir)).filter(f => REPORT_FILES.includes(f))
  await writeFile(join(runDir, REPORT_HASH_FILE), await hashList(runDir, present))
}

/** Checks every listed hash and names files that are listed but changed, missing, or not listed. */
export const checkHashes = async (runDir: string, listFile: string): Promise<string[]> => {
  const problems: string[] = []
  const text = await readFile(join(runDir, listFile), 'utf8').catch(() => undefined)
  if (text === undefined) return [`${listFile} is missing`]

  const listed = new Set<string>()
  for (const line of text.split('\n').filter(Boolean)) {
    const [hash, ...rest] = line.split('  ')
    const file = rest.join('  ')
    listed.add(file)
    const actual = await readFile(join(runDir, file)).then(sha256, () => undefined)
    if (actual === undefined) problems.push(`${file}: missing`)
    else if (actual !== hash) problems.push(`${file}: changed since it was hashed`)
  }

  if (listFile === EVIDENCE_FILE) {
    for (const file of await listFiles(runDir)) {
      if (!NOT_EVIDENCE.has(file) && !listed.has(file)) problems.push(`${file}: not in ${EVIDENCE_FILE}`)
    }
  }

  return problems
}
