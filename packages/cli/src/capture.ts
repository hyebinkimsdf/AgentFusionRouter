import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

// Full-page screenshots through a headless Chrome or Edge, driven over the
// DevTools pipe: the page is measured first, so the image is its exact height.

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
}

/** A Chrome-family browser: `AFR_BROWSER` if set, else the usual install paths. */
export const findBrowser = (): string | undefined =>
  process.env.AFR_BROWSER ?? (CANDIDATES[process.platform] ?? []).find(p => existsSync(p))

type Message = { id?: number; method?: string; sessionId?: string; result?: Record<string, unknown>; error?: { message: string } }

export const capturePage = async (htmlPath: string, pngPath: string, width = 1280): Promise<string> => {
  const browser = findBrowser()
  if (browser === undefined) throw new Error('No Chrome or Edge found. Set AFR_BROWSER to a Chrome-family browser to take screenshots.')

  const profile = await mkdtemp(join(tmpdir(), 'afr-capture-'))
  const proc = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--remote-debugging-pipe',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  )
  const toBrowser = proc.stdio[3] as Writable
  const fromBrowser = proc.stdio[4] as Readable

  let nextId = 1
  const pending = new Map<number, (m: Message) => void>()
  const listeners: ((m: Message) => void)[] = []
  let buffer = ''

  fromBrowser.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let end = buffer.indexOf('\0')
    while (end !== -1) {
      const message = JSON.parse(buffer.slice(0, end)) as Message
      buffer = buffer.slice(end + 1)
      if (message.id !== undefined) pending.get(message.id)?.(message)
      else listeners.forEach(l => l(message))
      end = buffer.indexOf('\0')
    }
  })

  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = nextId++
      pending.set(id, m => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result ?? {})))
      toBrowser.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
    })

  const timeout = setTimeout(() => proc.kill(), 60_000)

  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string }
    await send('Page.enable', {}, sessionId)
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)

    const loaded = new Promise<void>(resolve =>
      listeners.push(m => {
        if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) resolve()
      }),
    )
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId)
    await loaded

    const metrics = (await send('Page.getLayoutMetrics', {}, sessionId)) as { cssContentSize: { height: number } }
    const height = Math.ceil(metrics.cssContentSize.height)
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId)

    const { data } = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)) as { data: string }
    await writeFile(pngPath, Buffer.from(data, 'base64'))
    await send('Browser.close').catch(() => {})

    return browser
  } finally {
    clearTimeout(timeout)
    proc.kill()
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}
