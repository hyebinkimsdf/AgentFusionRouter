// A client for `codex app-server`: JSON-RPC messages, one per line, over the
// process's stdin and stdout. The protocol is Codex's own and marked
// experimental; the fields used here were checked against Codex 0.164
// (`codex app-server generate-json-schema`).

import { spawn, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'

export type Notification = { method: string; params?: Record<string, unknown> }

/** A request from the server that the client must answer: an approval, mostly. */
export type ServerRequest = { id: number | string; method: string; params?: Record<string, unknown> }

export type AppServer = {
  request: <T = Record<string, unknown>>(method: string, params?: unknown) => Promise<T>
  notify: (method: string, params?: unknown) => void
  /** Calls `listener` for every notification until the returned function is called. */
  listen: (listener: (n: Notification) => void) => () => void
  /** Settles when the connection ends; pending requests fail then. */
  closed: Promise<void>
  close: () => void
}

/**
 * Speaks the protocol over any pair of streams, so tests can stand in a fake
 * server. `answer` replies to the server's requests; a throw answers with an
 * error.
 */
export const connect = (io: { input: Readable; output: Writable }, answer: (r: ServerRequest) => Promise<unknown>): AppServer => {
  let nextId = 1
  let buffer = ''
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const listeners = new Set<(n: Notification) => void>()
  const send = (message: object): void => {
    if (!io.output.writableEnded) io.output.write(`${JSON.stringify(message)}\n`)
  }

  const handle = (line: string): void => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    const { id, method } = message
    if (typeof method === 'string' && (typeof id === 'number' || typeof id === 'string')) {
      answer({ id, method, params: message.params as Record<string, unknown> | undefined }).then(
        result => send({ id, result }),
        (error: unknown) => send({ id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }),
      )
    } else if (typeof method === 'string') {
      for (const listener of [...listeners]) listener({ method, params: message.params as Record<string, unknown> | undefined })
    } else if (typeof id === 'number' && pending.has(id)) {
      const waiter = pending.get(id)
      pending.delete(id)
      if (message.error !== undefined) waiter?.reject(new Error(`app-server: ${JSON.stringify(message.error)}`))
      else waiter?.resolve(message.result)
    }
  }

  const closed = new Promise<void>(resolve => {
    io.input.on('data', (chunk: Buffer | string) => {
      buffer += String(chunk)
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (line !== '') handle(line)
      }
    })
    io.input.on('end', () => {
      for (const waiter of pending.values()) waiter.reject(new Error('app-server: the connection closed'))
      pending.clear()
      resolve()
    })
  })

  return {
    request: <T>(method: string, params?: unknown) =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve: v => resolve(v as T), reject })
        send({ id, method, ...(params === undefined ? {} : { params }) })
      }),
    notify: (method, params) => send({ method, ...(params === undefined ? {} : { params }) }),
    listen: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    closed,
    close: () => io.output.end(),
  }
}

/**
 * The codex executable: `CODEX_BIN`, else `codex` on the PATH, else the
 * newest one bundled with the Codex VS Code extension.
 */
export const findCodexBin = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  if (env.CODEX_BIN) return env.CODEX_BIN
  if (spawnSync('codex --version', { shell: true, stdio: 'ignore' }).status === 0) return 'codex'

  const extensions = join(homedir(), '.vscode', 'extensions')
  const list = (dir: string): string[] => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  }
  // The extension ships a folder per platform (`windows-x86_64`, `linux-x86_64`): only this machine's runs.
  const os = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform as string]
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch as string]
  const versions = list(extensions)
    .filter(d => d.startsWith('openai.chatgpt-'))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const version of versions) {
    const folder = join(extensions, version, 'bin', `${os}-${arch}`)
    const bin = list(folder).find(f => f === (process.platform === 'win32' ? 'codex.exe' : 'codex'))
    if (bin !== undefined) return join(folder, bin)
  }
  return undefined
}

/**
 * Starts `codex app-server` and connects to it. A bare `codex` on Windows may
 * be an npm `.cmd` shim, which only runs through the shell, given as one
 * command line.
 */
export const spawnAppServer = (bin: string, answer: (r: ServerRequest) => Promise<unknown>): { server: AppServer; stop: () => void; stderr: () => string } => {
  const viaShell = process.platform === 'win32' && !/\.exe$/i.test(bin)
  const child = viaShell
    ? spawn(`"${bin}" app-server`, { stdio: ['pipe', 'pipe', 'pipe'], shell: true })
    : spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = `${stderr}${String(d)}`.slice(-4000)
  })
  const server = connect({ input: child.stdout, output: child.stdin }, answer)

  return {
    server,
    stop: () => {
      server.close()
      setTimeout(() => child.kill(), 1500).unref()
    },
    stderr: () => stderr,
  }
}
