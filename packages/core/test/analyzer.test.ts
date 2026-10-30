import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { analyzeTask } from '../src/analyzer.ts'
import type { Tier } from '../src/types.ts'

// The labelled set the rules are tuned against. Add a case before changing a
// rule, so a fix for one prompt cannot quietly move another.
const CASES: readonly [prompt: string, tier: Tier][] = [
  ['where is parseConfig defined?', 'light'],
  ['find all usages of the legacy logger', 'light'],
  ['fix the typo in README.md', 'light'],
  ['rename getUser to fetchUser in src/api/user.ts', 'light'],
  ['sort the imports in app.tsx', 'light'],
  ['parseConfig 함수가 어디에 정의돼 있는지 찾아줘', 'light'],
  ['README.md 오타 고쳐줘', 'light'],
  ['add a dark mode toggle component to the settings page', 'standard'],
  ['the login form throws an error when the email is empty, fix it', 'standard'],
  ['로그인 버튼 누르면 에러가 나요. 고쳐주세요', 'standard'],
  ['회원가입 폼에 비밀번호 확인 기능 추가해줘', 'standard'],
  ['rename the Logger class across the entire codebase', 'standard'],
  ['hello', 'standard'],
  ['design the architecture for multi-tenant billing', 'heavy'],
  ['why does this test fail intermittently on CI?', 'heavy'],
  ['should we migrate from REST to GraphQL? what are the trade-offs?', 'heavy'],
  ['결제 모듈 구조를 어떻게 잡는 게 좋을까?', 'heavy'],
  ['인증 로직 전면 리팩터링 해줘', 'heavy'],
]

describe('analyzeTask', () => {
  for (const [prompt, tier] of CASES) {
    test(`${tier}: ${prompt}`, () => {
      assert.equal(analyzeTask(prompt).tier, tier)
    })
  }

  test('a light task needs unopposed signals to be confident', () => {
    assert.ok(analyzeTask('where is parseConfig defined?').confidence >= 0.5)
    assert.ok(analyzeTask('find where we parse config and add caching').confidence < 0.5)
  })

  test('length alone does not raise the tier', () => {
    const long = `rename getUser to fetchUser. ${'The function is called from a few places. '.repeat(40)}`

    assert.equal(analyzeTask(long).tier, 'light')
  })

  test('nothing matched is standard with no confidence', () => {
    assert.deepEqual(analyzeTask('hmm'), {
      kind: 'unknown',
      tier: 'standard',
      confidence: 0,
      followUp: undefined,
      signals: [],
    })
  })

  test('short acknowledgements are continuations', () => {
    for (const text of ['continue', 'yes', 'ok!', '계속해', 'ㅇㅇ', '진행해']) {
      assert.equal(analyzeTask(text).followUp, 'continue', text)
    }
  })

  test('a reply about the last attempt is a failure follow-up', () => {
    for (const text of ['still failing', 'same error as before', '여전히 안 돼요', '똑같은 에러가 나']) {
      assert.equal(analyzeTask(text).followUp, 'failure', text)
    }
  })

  test('a new bug report is not a failure follow-up', () => {
    assert.equal(analyzeTask("the export button doesn't work").followUp, undefined)
  })

  test('signals never carry the prompt text', () => {
    const { signals } = analyzeTask('rename secretProjectName in billing.ts for production')

    assert.ok(signals.every(s => !s.includes('secretProjectName')))
  })
})
