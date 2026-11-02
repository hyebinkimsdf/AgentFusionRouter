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
  // Short questions about the work so far.
  ['프로젝트 이름은 이걸로 하는 게 좋을까?', 'light'],
  ['그럼 이건 자동으로 바뀌는 건 아니잖아', 'light'],
  ['혼자 운영하기엔 서버 비용이 무리이지 않을까', 'light'],
  ['앞에서 말한 내용이 왜 문제인지 설명해줄래', 'light'],
  ['작업은 하지 말고 대답만 해줘', 'light'],
  ['what do you think about this name?', 'light'],
  // A question about a hard thing stays where the hard thing puts it.
  ['인증 방식을 바꾸는 게 좋을까?', 'heavy'],
  ['로그인이 왜 안 되는지 원인 찾아줘', 'heavy'],
  ['아키텍처랑 구현 과정을 자세히 알려줘, 구현하지 말고', 'heavy'],
  ['로그인 기능을 만드는 게 좋을까?', 'standard'],
]

// Another agent's report, as people paste one to ask for a second opinion:
// full of words that name hard work.
const REPORT = [
  '결제 모듈의 아키텍처를 재설계했고, 인증 권한 검사를 서버로 옮겼습니다. 운영 DB 마이그레이션은 배포할 때 실행됩니다.',
  '',
  '- src/payments/service.ts, src/auth/session.ts, src/api/routes.ts, src/db/migrate.ts를 수정했습니다.',
  '- 전체 테스트 166개가 통과했습니다. 간헐적으로 실패하던 테스트의 원인은 경쟁 조건이었습니다.',
  '- 보안상 남는 한계: 개발자 도구로 우회할 수 있는 경로가 하나 있습니다.',
  '',
  '**역할별 결과**',
  '',
  '- 대표·시스템 관리자: 대시보드, 합계, 엑셀 다운로드를 모두 쓸 수 있습니다.',
  '- 회계·조회 전용: 메뉴가 숨겨지고, 로그인하면 목록 화면으로 이동합니다.',
  '- 권한 저장 API는 다른 역할을 넣어 보내도 두 역할로만 저장합니다.',
  '',
  '**배포 시 참고**',
  '',
  '- 다운로드 기록은 서버가 파일을 만든 뒤에만 남깁니다. 실패하면 기록하지 않습니다.',
  '- 보류 중인 작업과 같은 파일을 건드리지 않아서, 이번 변경만 따로 커밋할 수 있습니다.',
  '',
  '커밋·배포할까요?',
].join('\n')

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

  test('a pasted report with a request for a check is a review, judged by the request', () => {
    for (const text of [`${REPORT}\n\n해당 내용 문제가 없는지 확인해줘`, `${REPORT} 어떻게 생각해?`, `아래처럼 진행했는데 문제가 없는지 확인해줘\n\n${REPORT}`]) {
      const a = analyzeTask(text)
      assert.equal(a.kind, 'review', text.slice(-30))
      assert.equal(a.tier, 'standard', text.slice(-30))
    }
  })

  test("the request's own risk still raises a review", () => {
    assert.equal(analyzeTask(`결제 권한을 대표만 쓰게 하라는 요청에 아래처럼 진행했는데 확인해줘\n\n${REPORT}`).tier, 'heavy')
  })

  test('a long message that asks for work is read whole', () => {
    for (const text of [`${REPORT}\n\n위 내용대로 구현해줘`, `${REPORT}\n\n끝나면 테스트로 확인해줘`, `이 기능 구현해줘\n\n${REPORT}\n\n해당 내용 참고`]) {
      const a = analyzeTask(text)
      assert.notEqual(a.kind, 'review', text.slice(-30))
      assert.equal(a.tier, 'heavy', text.slice(-30))
    }
  })

  test('signals never carry the prompt text', () => {
    const { signals } = analyzeTask('rename secretProjectName in billing.ts for production')

    assert.ok(signals.every(s => !s.includes('secretProjectName')))
  })
})
