import type { Tier } from './types.ts'
import { TIERS, bumpTier, tierRank } from './types.ts'

export type TaskKind = 'lookup' | 'mechanical' | 'implement' | 'debug' | 'design' | 'unknown'

/** How a short reply relates to the previous turn. */
export type FollowUp = 'continue' | 'failure'

export type Analysis = {
  kind: TaskKind
  /** The tier the text alone suggests. */
  tier: Tier
  /** 0 when nothing matched; rises with agreeing, unopposed signals. */
  confidence: number
  followUp?: FollowUp
  /** Names of the signals that fired. Safe to log: never the text itself. */
  signals: string[]
}

type Rule = { name: string; kind: TaskKind; tier: Tier; weight: number; pattern: RegExp }

// English alternatives sit inside \b...\b; Korean ones after it, since \b
// does not see Hangul as word characters.
const RULES: readonly Rule[] = [
  {
    name: 'lookup',
    kind: 'lookup',
    tier: 'light',
    weight: 2,
    pattern:
      /\b(where (is|are|does|do)|find (the|all|where|every)|look up|which files?|list (all|the|every)|show me|grep|search for)\b|어디(에|서)?\s?(있|정의|쓰|사용)|찾아(줘|봐|서)?|목록|보여\s?줘|검색해/i,
  },
  {
    name: 'mechanical',
    kind: 'mechanical',
    tier: 'light',
    weight: 3,
    pattern:
      /\b(rename|typos?|spelling|reformat|sort (the )?imports|bump (the )?version|update (the )?(copyright|year|version)|add (a )?comments?|remove (unused|dead)|replace \S.{0,40} with)\b|오타|이름(을)?\s?바꿔|포맷(팅)?|import\s?정렬|주석(을)?\s?(달|추가)|버전(을)?\s?올려|치환/i,
  },
  {
    name: 'explain',
    kind: 'lookup',
    tier: 'light',
    weight: 1,
    pattern: /\b(explain|summari[sz]e|what is|what does|how does)\b|설명해|요약해/i,
  },
  {
    name: 'implement',
    kind: 'implement',
    tier: 'standard',
    weight: 2,
    pattern:
      /\b(implement|add(?! (a )?comments?\b) \w+|create (a|an|the)|build (a|an)|write (a|an|the)|hook up|wire up|endpoint|component|feature|support for)\b|구현|추가해|만들어|작성해|기능/i,
  },
  {
    // A bare verb: "fix the typo" is still a typo.
    name: 'fix',
    kind: 'debug',
    tier: 'standard',
    weight: 1,
    pattern: /\b(fix|change|update|modify)\b|고쳐|수정해|바꿔/i,
  },
  {
    name: 'debug',
    kind: 'debug',
    tier: 'standard',
    weight: 2,
    pattern:
      /\b(bugs?|errors?|exception|crash(es|ing)?|fail(s|ing|ed)?|broken|stack ?trace|traceback|regression)\b|버그|에러|오류|실패|예외/i,
  },
  {
    name: 'design',
    kind: 'design',
    tier: 'heavy',
    weight: 3,
    pattern:
      /\b(architect(ure)?|design (a|the|an)|redesign|re-?architect|trade-?offs?|strategy|approach (for|to)|migrat(e|ion)|refactor (the|our|all)|overhaul|rewrite)\b|설계|아키텍처|구조(를)?\s?(바꿔|개선|잡)|전략|마이그레이션|리팩(터|토)링|재작성|전면/i,
  },
  {
    name: 'investigate',
    kind: 'debug',
    tier: 'heavy',
    weight: 2,
    pattern:
      /\b(why (does|is|do|did|are)|root cause|investigate|intermittent|flaky|race condition|deadlock|memory leak|non-?deterministic)\b|왜\s|원인|간헐적|경쟁\s?조건|교착|메모리\s?누수/i,
  },
  {
    name: 'uncertain',
    kind: 'design',
    tier: 'heavy',
    weight: 2,
    pattern:
      /\b(should (i|we)|which (is|would be) better|best way|not sure|unclear|pros and cons)\b|좋을까|나을까|어떻게 하면 좋|장단점|모르겠/i,
  },
]

const RISK =
  /\b(prod(uction)?|deploy(ment)?|schema change|auth(entication|orization)?|payments?|billing|security|secrets?|credentials?|encryption|data loss)\b|운영\s?(서버|환경|DB)|배포|결제|인증|권한|보안|암호화|개인정보|데이터\s?삭제/i

const BREADTH =
  /\b(all files|every (file|module|component|package)|entire (codebase|repo|project|app)|across (the )?(codebase|repo|project|modules|packages)|whole (codebase|project|repo)|everywhere|project-?wide)\b|전체\s?(코드|파일|프로젝트)|모든\s?(파일|모듈|컴포넌트|패키지)|프로젝트\s?전반/i

const VERIFY = /\b(tests?|specs?|typecheck|lint|ci)\b|테스트/i

const FILE_REF =
  /(?:[\w.-]+\/)*[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|cc|cpp|hpp|css|scss|html|vue|svelte|md|json|ya?ml|toml|sql|sh)\b/gi

const CONTINUE =
  /^\s*(continue|go on|go ahead|proceed|keep going|yes|yep|yeah|ok(ay)?|sure|do it|lgtm|sounds good|계속(해|하자)?|진행(해)?|응|네|예|ㅇㅇ|ㅇㅋ|좋아|그래|해줘|부탁해)[\s.!~]*$/i

// Only phrasings that point back at the last attempt: "it doesn't work" on
// its own is just as often a new bug report.
const FAILURE =
  /\b(still (fails?|failing|broken|not working|doesn'?t work|getting|seeing|the same)|didn'?t (work|fix)|same (error|problem|issue)|wrong again|that broke)\b|여전히|아직도\s?(안|에러|오류)|똑같은\s?(에러|오류|문제)|또\s?(에러|오류|안)|해결이\s?안|안\s?고쳐/i

/** The analyzer reads at most this much: long pastes are mostly logs. */
const MAX_CHARS = 4000

/**
 * Classifies a task from its text by rules alone. Length is not a signal:
 * a long, precise spec can be easier than a short, vague question.
 */
export const analyzeTask = (input: string): Analysis => {
  const text = input.slice(0, MAX_CHARS)
  const signals: string[] = []

  if (CONTINUE.test(text)) {
    return { kind: 'unknown', tier: 'standard', confidence: 0, followUp: 'continue', signals: ['follow-up:continue'] }
  }

  const followUp: FollowUp | undefined = FAILURE.test(text) ? 'failure' : undefined
  if (followUp) signals.push('follow-up:failure')

  const scores: Record<Tier, number> = { light: 0, standard: 0, heavy: 0 }
  const kinds = new Map<TaskKind, number>()

  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue
    scores[rule.tier] += rule.weight
    kinds.set(rule.kind, (kinds.get(rule.kind) ?? 0) + rule.weight)
    signals.push(rule.name)
  }

  const files = new Set(text.match(FILE_REF) ?? []).size
  if (files >= 4) {
    scores.heavy += 1
    signals.push('files:many')
  } else if (files > 0) {
    signals.push(`files:${files}`)
  }

  if (RISK.test(text)) {
    scores.heavy += 2
    signals.push('risk')
  }

  const isWide = BREADTH.test(text)
  if (isWide) signals.push('scope:wide')

  const hasVerification = VERIFY.test(text)
  if (hasVerification) signals.push('verify')

  const ranked = [...TIERS].sort((a, b) => scores[b] - scores[a] || tierRank(b) - tierRank(a))
  const [first = 'standard', second = 'standard'] = ranked
  const top = scores[first]

  if (top === 0) {
    return { kind: 'unknown', tier: 'standard', confidence: 0, followUp, signals }
  }

  // A wide change is never light, however mechanical each edit is.
  const tier = isWide && first === 'light' ? bumpTier(first) : first
  const margin = (top - scores[second]) / (top + 1)
  const confidence = Math.min(0.95, margin + (hasVerification && tier !== 'heavy' ? 0.1 : 0))
  const kind = [...kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'

  return { kind, tier, confidence: round(confidence), followUp, signals }
}

const round = (n: number): number => Math.round(n * 100) / 100
