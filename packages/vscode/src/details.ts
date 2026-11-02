// The details page behind the status bar entry: the same figures and words as
// the CLI's `report` and `codex-usage`, in the editor's own colors. No script
// runs in it, and it loads nothing.

import { formatCodexCosts, formatCodexUsage } from '@agent-fusion-router/codex-adapter'
import { formatReport } from '@agent-fusion-router/core'

import type { Lang } from './figures.ts'
import { money } from './figures.ts'
import type { Loaded } from './load.ts'

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

const TEXT = {
  ko: {
    period: { today: '오늘', '7d': '최근 7일', '30d': '최근 30일' },
    since: '부터',
    basis: '모든 금액은 API 요금 환산 추정치입니다. 청구액이 아니며, 측정된 절감도 아닙니다. 실제 절감은 벤치마크로만 확인할 수 있습니다.',
    claudeSaved: 'Claude 라우팅 절감 추정',
    claudeSavedNote: 'API 요금 환산, 같은 토큰 기준',
    claudePotential: 'Claude 잠재 절감',
    claudePotentialNote: '관측 모드, API 요금 환산 시뮬레이션',
    codexPotential: 'Codex 잠재 절감',
    codexPotentialNote: 'API 요금 환산 시뮬레이션',
    codexCost: 'Codex API 요금 환산 비용',
    codexCostNote: 'ChatGPT 플랜은 이 금액을 청구하지 않음',
    claudeCost: 'Claude API 요금 환산 비용',
    noClaude: '이 기간에 Claude Code 플러그인 기록이 없습니다.',
    noCodex: '이 기간에 쓰인 Codex 세션 기록이 없습니다.',
    reconciliation: '요청별 원장과 Codex 누적값 대조 (이 기간에 쓰인 파일 전체)',
    sources: '읽은 위치',
    generated: '생성',
  },
  en: {
    period: { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days' },
    since: 'since',
    basis: 'Every amount is an estimate at API list prices. None is a bill, and none is a measured saving: only a benchmark measures that.',
    claudeSaved: 'Claude routing savings (est.)',
    claudeSavedNote: 'API list prices, same tokens',
    claudePotential: 'Claude potential savings',
    claudePotentialNote: 'observe mode, API list prices, simulation',
    codexPotential: 'Codex potential savings',
    codexPotentialNote: 'API list prices, simulation',
    codexCost: 'Codex at API list prices',
    codexCostNote: 'a ChatGPT plan does not charge this',
    claudeCost: 'Claude at API list prices',
    noClaude: 'No Claude Code plugin records in this period.',
    noCodex: 'No Codex session records written in this period.',
    reconciliation: "Per-request ledger and Codex's running totals (every file written in this period)",
    sources: 'Read from',
    generated: 'Generated',
  },
} as const

const tile = (label: string, value: string, note: string): string =>
  `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="note">${esc(note)}</div></div>`

export const renderDetails = (loaded: Loaded, lang: Lang, now: Date): string => {
  const t = TEXT[lang]
  const { claude, codex } = loaded.figures
  const tiles = [
    ...(claude === undefined
      ? []
      : [
          claude.routingSavingsUsd !== undefined
            ? tile(t.claudeSaved, money(claude.routingSavingsUsd), t.claudeSavedNote)
            : tile(t.claudePotential, money(claude.potentialSavingsUsd ?? 0), t.claudePotentialNote),
          tile(t.claudeCost, money(claude.costUsd), `${claude.requests}`),
        ]),
    ...(codex === undefined ? [] : [tile(t.codexPotential, money(codex.potentialSavingsUsd), t.codexPotentialNote), tile(t.codexCost, money(codex.costUsd), t.codexCostNote)]),
  ]

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Fusion Router</title>
<style>
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.5; padding: 16px 20px; max-width: 980px; }
h1 { font-size: 1.5em; margin: 0 0 4px; }
h2 { font-size: 1.15em; margin: 28px 0 10px; }
.sub, .note, footer { color: var(--vscode-descriptionForeground); }
.basis { border-left: 3px solid var(--vscode-editorWarning-foreground); padding: 8px 12px; margin: 14px 0; background: var(--vscode-textBlockQuote-background); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 14px 0; }
.tile { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; }
.tile .label, .tile .note { font-size: 0.9em; color: var(--vscode-descriptionForeground); }
.tile .value { font-size: 1.6em; font-weight: 600; font-variant-numeric: tabular-nums; }
pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 6px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 0.92em; line-height: 1.45; }
details summary { cursor: pointer; margin: 8px 0; }
code { font-family: var(--vscode-editor-font-family); }
footer { margin-top: 28px; font-size: 0.9em; }
</style>
</head>
<body>
<h1>Agent Fusion Router · ${esc(t.period[loaded.figures.period])}</h1>
<p class="sub">${esc(new Date(loaded.from).toLocaleString(lang))} ${esc(t.since)}</p>
<p class="basis">${esc(t.basis)}</p>
${tiles.length === 0 ? '' : `<div class="tiles">${tiles.join('')}</div>`}
<h2>Claude Code</h2>
${loaded.claude.requests === 0 ? `<p>${esc(t.noClaude)}</p>` : `<pre>${esc(formatReport(loaded.claude))}</pre>`}
<h2>Codex</h2>
${
  loaded.codex === undefined
    ? `<p>${esc(t.noCodex)}</p>`
    : `<pre>${esc(formatCodexCosts(loaded.codex.costs))}</pre>
<details><summary>${esc(t.reconciliation)}</summary><pre>${esc(formatCodexUsage(loaded.codex.usage))}</pre></details>`
}
<footer>${esc(t.sources)}: <code>${esc(loaded.claudeDir)}</code> · <code>${esc(loaded.codexHome)}</code><br>${esc(t.generated)}: ${esc(now.toLocaleString(lang))}</footer>
</body>
</html>`
}
