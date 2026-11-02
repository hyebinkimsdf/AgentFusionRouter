// The status bar entry. It only reads: the Claude Code plugin's logs and
// Codex's session records, on a timer and on demand, and shows what the CLI's
// `report` would, labelled as estimates at API list prices.

import * as vscode from 'vscode'

import { renderDetails } from './details.ts'
import type { Lang, Period } from './figures.ts'
import { statusText, tooltipText } from './figures.ts'
import type { Loaded, Settings } from './load.ts'
import { createLoader } from './load.ts'

const SECTION = 'agentFusionRouter'

const readSettings = (): Settings & { refreshMinutes: number } => {
  const c = vscode.workspace.getConfiguration(SECTION)
  return {
    period: c.get<Period>('period', 'today'),
    refreshMinutes: Math.max(1, c.get<number>('refreshMinutes', 5)),
    claudeLogDir: c.get<string>('claudeLogDir', '').trim(),
    codexHome: c.get<string>('codexHome', '').trim(),
    codexStandardModel: c.get<string>('codexStandardModel', '').trim(),
  }
}

export const activate = (context: vscode.ExtensionContext): void => {
  const lang: Lang = vscode.env.language.toLowerCase().startsWith('ko') ? 'ko' : 'en'
  const loader = createLoader()
  const item = vscode.window.createStatusBarItem(`${SECTION}.savings`, vscode.StatusBarAlignment.Right, 100)
  item.name = 'Agent Fusion Router'
  item.command = `${SECTION}.showDetails`
  item.text = '$(sync~spin) Agent Fusion Router'
  item.show()

  let last: Loaded | undefined
  let panel: vscode.WebviewPanel | undefined
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const refresh = (): Promise<void> =>
    // One read at a time: a timer firing during a slow read joins it.
    (running ??= (async () => {
      try {
        last = await loader.load(readSettings(), new Date())
        item.text = statusText(last.figures, lang)
        item.tooltip = tooltipText(last.figures, lang)
        item.backgroundColor = undefined
        if (panel !== undefined) panel.webview.html = renderDetails(last, lang, new Date())
      } catch (error) {
        item.text = '$(warning) Agent Fusion Router'
        item.tooltip = error instanceof Error ? error.message : String(error)
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
      } finally {
        running = undefined
      }
    })())

  const schedule = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = setInterval(() => void refresh(), readSettings().refreshMinutes * 60_000)
  }

  const showDetails = async (): Promise<void> => {
    if (panel === undefined) {
      panel = vscode.window.createWebviewPanel(`${SECTION}.details`, 'Agent Fusion Router', vscode.ViewColumn.Active, { enableScripts: false })
      panel.onDidDispose(() => (panel = undefined), undefined, context.subscriptions)
    } else {
      panel.reveal()
    }
    await refresh()
    if (panel !== undefined && last !== undefined) panel.webview.html = renderDetails(last, lang, new Date())
  }

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand(`${SECTION}.showDetails`, showDetails),
    vscode.commands.registerCommand(`${SECTION}.refresh`, refresh),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(SECTION)) return
      schedule()
      void refresh()
    }),
    { dispose: () => timer !== undefined && clearInterval(timer) },
  )

  schedule()
  void refresh()
}

export const deactivate = (): void => {}
