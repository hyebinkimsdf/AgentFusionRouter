import type { Tier } from './types.ts'
import { TIERS, bumpTier, tierRank } from './types.ts'

/**
 * `review` is a check of material pasted into the message (another agent's
 * report, a plan); `question` asks for an answer or an opinion, not work.
 */
export type TaskKind = 'lookup' | 'mechanical' | 'implement' | 'debug' | 'design' | 'review' | 'question' | 'unknown'

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

/** `work` rules ask for a change, and do not count when the message asks for none. */
type Rule = { name: string; kind: TaskKind; tier: Tier; weight: number; pattern: RegExp; work?: true }

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
    pattern: /\b(explain|summari[sz]e|what is|what does|how does)\b|설명(해|한다면)|요약(해|하면|한다면)|간략(하게|히)/i,
  },
  {
    // A short question about the work so far, or about a choice: "좋을까?", "아니잖아".
    // Weaker than every heavy signal, so a question about a hard thing stays heavy.
    name: 'question',
    kind: 'question',
    tier: 'light',
    weight: 2,
    pattern:
      /\b(what do you think|your (thoughts|opinion|take)|does (this|that|it) make sense|is (this|that|it) (right|correct))\b|의견|어떻게 생각|어때|어떄|괜찮을까|좋을까|나을까|않나\?|않을까|아니(야|지|잖아)|아냐|거잖아|말이지|되려나|맞(아|지|나|는거)/i,
  },
  {
    name: 'implement',
    kind: 'implement',
    tier: 'standard',
    weight: 2,
    pattern:
      /\b(implement|add(?! (a )?comments?\b) \w+|create (a|an|the)|build (a|an)|write (a|an|the)|hook up|wire up|endpoint|component|feature|support for)\b|구현|추가해|만들어|작성해|기능/i,
    work: true,
  },
  {
    // A bare verb: "fix the typo" is still a typo.
    name: 'fix',
    kind: 'debug',
    tier: 'standard',
    weight: 1,
    pattern: /\b(fix|change|update|modify)\b|고쳐|수정해|바꿔/i,
    work: true,
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
      /\b(architect(ure)?|design (a|the|an)|redesign|re-?architect|trade-?offs?|strategy|approach (for|to)|migrat(e|ion)|refactor (the|our|all)|overhaul|rewrite)\b|설계|아키텍처|구조(를)?\s?(어떻게\s?)?(바꿔|개선|잡)|전략|마이그레이션|리팩(터|토)링|재작성|전면/i,
  },
  {
    // "왜" only next to a failure: "왜 문제인지 설명해줘" asks for an explanation, not a hunt.
    name: 'investigate',
    kind: 'debug',
    tier: 'heavy',
    weight: 2,
    pattern:
      /\b(why (does|is|do|did|are)|root cause|investigate|intermittent|flaky|race condition|deadlock|memory leak|non-?deterministic)\b|왜.{0,15}(안\s?(돼|되|나와|떠)|에러|오류|실패|느려|죽|터져|깨져)|원인|간헐적|경쟁\s?조건|교착|메모리\s?누수/i,
  },
  {
    // A choice between approaches. A bare "좋을까?" is a question, above.
    name: 'uncertain',
    kind: 'design',
    tier: 'heavy',
    weight: 2,
    pattern:
      /\b(should (i|we)|which (is|would be) better|best way|not sure|unclear|pros and cons)\b|(어떤|어느|뭐)\s?(게|것이|쪽이)\s?(더\s?)?(나을|좋을)|어떻게 하면 좋|장단점|모르겠/i,
  },
]

/** Asks for an answer and no change: the work rules do not count, and it reads as a question. */
const ANSWER_ONLY =
  /\b((do not|don'?t) (change|edit|modify|implement|touch)|without (changing|editing|modifying)|no code changes|just (answer|tell me))\b|(수정|작업|구현|변경)(은|는)?\s?하지\s?말고|대답만|답만|의견만|설명만/i

/** A message this long can carry pasted material: another agent's report, a plan, a draft. */
const PASTE_MIN_CHARS = 400

/** Points at material in the message ("해당 내용", "the above"); "헤당" is a common typo. */
const REFERS =
  /[해헤]당\s?(내용|글|부분|아티클|문서|답변)|(아래|위|이)\s?(내용|처럼|글|계획|답변|보고)|\b(the (above|below|following)|this (plan|report|proposal|draft|summary|review|answer))\b/i

const OPINION = /의견|어떻게 생각|어때|어떄|괜찮(을까|아\?)|\b(what do you think|your (thoughts|opinion|take)|does (this|it) (look right|make sense))\b/i

const CHECK = /확인해|검토해|봐\s?줘|문제(가)?\s?없|답해|대답해|\b(review|check)\b/i

/** A request for work, as an imperative: "어떻게 구현해야" mentions work without asking for it. */
const WORK =
  /(구현|추가|작성|수정|적용|반영|변경|진행)해\s?(줘|주세요|줄래|봐)|(만들어|고쳐|바꿔)\s?(줘|주세요|줄래|봐)|\b(please )?(implement|fix|add|create|build|write|change|update|apply) (it|this|that|them|these|those)\b/i

/**
 * The person's own words, when the message pastes material and asks for a
 * check or an opinion of it: the first paragraph ("아래처럼 진행했는데
 * 확인해줘", then the paste), or the last few sentences (the paste, then
 * "해당 내용 어떻게 생각해?"). The paste's own words say what it is about, not
 * what to do with it. Undefined for anything else; a long spec that asks for
 * work is read whole.
 */
const askAround = (input: string): string | undefined => {
  if (input.length < PASTE_MIN_CHARS) return undefined
  const short = (ask: string): string | undefined => (ask.length <= Math.min(600, input.length / 2) && !WORK.test(ask) ? ask : undefined)

  const head = input.split(/\n\s*\n/, 1)[0] ?? ''
  if (REFERS.test(head) && (OPINION.test(head) || CHECK.test(head))) return short(head)
  if (WORK.test(head)) return undefined

  const sentences = (input.trimEnd().split(/\n\s*\n/).at(-1) ?? '').split(/(?<=[.?!])\s+|\n+/).filter(s => s.trim() !== '')
  for (let i = sentences.length - 1; i >= Math.max(0, sentences.length - 3); i--) {
    if (REFERS.test(sentences[i] ?? '') || OPINION.test(sentences[i] ?? '')) return short(sentences.slice(i).join(' '))
  }
  return undefined
}

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
  const ask = askAround(input)
  const text = ask ?? input.slice(0, MAX_CHARS)
  const signals: string[] = []

  if (CONTINUE.test(text)) {
    return { kind: 'unknown', tier: 'standard', confidence: 0, followUp: 'continue', signals: ['follow-up:continue'] }
  }

  const followUp: FollowUp | undefined = FAILURE.test(text) ? 'failure' : undefined
  if (followUp) signals.push('follow-up:failure')

  const scores: Record<Tier, number> = { light: 0, standard: 0, heavy: 0 }
  const kinds = new Map<TaskKind, number>()
  const add = (name: string, kind: TaskKind, tier: Tier, weight: number): void => {
    scores[tier] += weight
    kinds.set(kind, (kinds.get(kind) ?? 0) + weight)
    signals.push(name)
  }

  // Reading pasted material is never light work, however the ask is phrased.
  if (ask !== undefined) add('review', 'review', 'standard', 2)

  const answerOnly = ask === undefined && ANSWER_ONLY.test(text)
  if (answerOnly) add('answer-only', 'question', 'light', 2)

  for (const rule of RULES) {
    if ((answerOnly && rule.work) || (ask !== undefined && rule.tier === 'light')) continue
    if (rule.pattern.test(text)) add(rule.name, rule.kind, rule.tier, rule.weight)
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
