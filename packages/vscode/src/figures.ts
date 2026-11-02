// What the status bar says, and how it labels it. Every amount is at API list
// prices: none of it is a bill, and none of it is a measured saving. The
// Claude figure compares routed requests with the models they were asked
// for; the Codex figure is a simulation, as Codex itself was never routed.

import type { CodexCostSummary } from '@agent-fusion-router/codex-adapter'
import type { Summary } from '@agent-fusion-router/core'

export type Period = 'today' | '7d' | '30d'
export type Lang = 'ko' | 'en'

/** When a period starts: local midnight for today, else that many days back. */
export const periodStart = (period: Period, now: Date): number =>
  period === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : now.getTime() - (period === '7d' ? 7 : 30) * 86_400_000

export type Figures = {
  period: Period
  claude?: {
    requests: number
    costUsd: number
    /** Route mode: the same tokens at the models asked for, less what the routed requests cost. */
    routingSavingsUsd?: number
    /** Observe mode: what the router's choices would have saved on the same tokens. */
    potentialSavingsUsd?: number
  }
  codex?: {
    requests: number
    costUsd: number
    potentialSavingsUsd: number
    /** The model ordinary work was simulated on, when not each turn's own. */
    standardModel?: string
  }
}

export const toFigures = (period: Period, claude: Summary, codex: CodexCostSummary | undefined): Figures => ({
  period,
  ...(claude.requests === 0
    ? {}
    : {
        claude: {
          requests: claude.requests,
          costUsd: claude.costUsd,
          ...(claude.routedRequests > 0
            ? { routingSavingsUsd: claude.unroutedCostUsd - claude.costUsd }
            : { potentialSavingsUsd: claude.costUsd - claude.potentialCostUsd }),
        },
      }),
  ...(codex === undefined || codex.turns.total === 0
    ? {}
    : {
        codex: {
          requests: codex.byModel.reduce((n, m) => n + m.requests, 0),
          costUsd: codex.actualUsd,
          potentialSavingsUsd: codex.potentialSavingsUsd,
          ...(codex.policy.tiers.standard === undefined ? {} : { standardModel: codex.policy.tiers.standard }),
        },
      }),
})

const TEXT = {
  ko: {
    period: { today: '오늘', '7d': '최근 7일', '30d': '최근 30일' },
    claudeSaved: 'Claude 절감 추정',
    claudePotential: 'Claude 잠재',
    codexPotential: 'Codex 잠재',
    none: '기록 없음',
    claudeSavedNote: '라우팅한 요청을 원래 요청한 모델 가격으로 다시 계산한 값과의 차이. API 요금 환산, 같은 토큰 기준이며 측정된 절감이 아닙니다.',
    claudePotentialNote: '관측 모드에서 라우터가 골랐을 모델 가격 기준. API 요금 환산 시뮬레이션입니다.',
    codexPotentialNote: (model?: string) =>
      `이 라우터가 턴마다 모델을 골랐다면 아꼈을 금액. ${
        model === undefined
          ? '기본 정책(일반 작업은 그 턴의 모델 유지) 기준이며, 설정 agentFusionRouter.codexStandardModel로 다른 정책을 볼 수 있습니다.'
          : `일반 작업을 ${model}로 처리하는 정책 기준입니다.`
      } API 요금 환산 시뮬레이션이며 실제로 절약한 금액이 아닙니다.`,
    cost: (usd: string, n: number) => `API 요금 환산 비용 ${usd} · 요청 ${n}건`,
    codexPlan: 'ChatGPT 플랜에서는 이 금액이 청구되지 않습니다.',
    click: '클릭하면 상세 보고서가 열립니다.',
  },
  en: {
    period: { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days' },
    claudeSaved: 'Claude saved (est.)',
    claudePotential: 'Claude potential',
    codexPotential: 'Codex potential',
    none: 'no usage',
    claudeSavedNote: 'Routed requests priced at the models asked for, less what they cost. API list prices, same tokens: an estimate, not a measured saving.',
    claudePotentialNote: "At the models the router would have chosen in observe mode. API list prices: a simulation.",
    codexPotentialNote: (model?: string) =>
      `What this router would have saved choosing each turn's model, ${
        model === undefined
          ? "under its default policy (ordinary work keeps the turn's model); set agentFusionRouter.codexStandardModel to see another."
          : `with ordinary work on ${model}.`
      } API list prices: a simulation, not a saving that happened.`,
    cost: (usd: string, n: number) => `Cost at API list prices ${usd} · ${n} requests`,
    codexPlan: 'A ChatGPT plan does not charge this amount.',
    click: 'Click for the full report.',
  },
} as const

/** Dollars to the cent, the sign kept. */
export const money = (n: number): string => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`

/** One short status bar entry for both agents. */
export const statusText = (f: Figures, lang: Lang): string => {
  const t = TEXT[lang]
  const parts = [
    ...(f.claude === undefined
      ? []
      : [
          f.claude.routingSavingsUsd !== undefined
            ? `${t.claudeSaved} ${money(f.claude.routingSavingsUsd)}`
            : `${t.claudePotential} ${money(f.claude.potentialSavingsUsd ?? 0)}`,
        ]),
    ...(f.codex === undefined ? [] : [`${t.codexPotential} ${money(f.codex.potentialSavingsUsd)}`]),
  ]

  return `$(graph-line) ${parts.length === 0 ? t.none : parts.join(' · ')}`
}

/** The hover text: what each figure is and what it rests on. */
export const tooltipText = (f: Figures, lang: Lang): string => {
  const t = TEXT[lang]
  const lines = [`Agent Fusion Router · ${t.period[f.period]}`]

  if (f.claude !== undefined) {
    const saved = f.claude.routingSavingsUsd !== undefined
    lines.push(
      '',
      `${saved ? t.claudeSaved : t.claudePotential} ${money((saved ? f.claude.routingSavingsUsd : f.claude.potentialSavingsUsd) ?? 0)}`,
      saved ? t.claudeSavedNote : t.claudePotentialNote,
      t.cost(money(f.claude.costUsd), f.claude.requests),
    )
  }
  if (f.codex !== undefined) {
    lines.push('', `${t.codexPotential} ${money(f.codex.potentialSavingsUsd)}`, t.codexPotentialNote(f.codex.standardModel), t.cost(money(f.codex.costUsd), f.codex.requests), t.codexPlan)
  }
  if (f.claude === undefined && f.codex === undefined) lines.push('', t.none)

  lines.push('', t.click)
  return lines.join('\n')
}
