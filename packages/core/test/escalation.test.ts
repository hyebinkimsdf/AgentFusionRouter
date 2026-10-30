import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isVerificationCommand, newVerificationState, recordVerification } from '../src/escalation.ts'

describe('isVerificationCommand', () => {
  for (const command of [
    'npm test',
    'npm run build',
    'pnpm typecheck',
    'cd web && yarn test --watch=false',
    'npx tsc --noEmit',
    'pytest -q tests/',
    'python -m pytest',
    'go test ./...',
    'cargo clippy',
    './gradlew test',
    'node --test',
  ]) {
    test(`verifies: ${command}`, () => assert.equal(isVerificationCommand(command), true))
  }

  for (const command of ['npm install', 'git status', 'ls tests', 'cat jest.config.js', 'echo test']) {
    test(`does not verify: ${command}`, () => assert.equal(isVerificationCommand(command), false))
  }
})

describe('recordVerification', () => {
  test('two failures in a row escalate once', () => {
    let state = newVerificationState()

    const first = recordVerification(state, false)
    assert.equal(first.escalate, false)
    state = first.state

    const second = recordVerification(state, false)
    assert.equal(second.escalate, true)
    assert.equal(second.state.escalations, 1)
  })

  test('a pass in between resets the run', () => {
    let { state } = recordVerification(newVerificationState(), false)
    state = recordVerification(state, true).state

    assert.equal(recordVerification(state, false).escalate, false)
  })

  test('the per-turn cap stops further escalation', () => {
    let state = newVerificationState()
    const escalations: boolean[] = []

    for (let i = 0; i < 6; i += 1) {
      const r = recordVerification(state, false)
      escalations.push(r.escalate)
      state = r.state
    }

    assert.deepEqual(escalations.filter(Boolean).length, 1)
    assert.equal(state.failures, 6)
    assert.equal(state.last, 'fail')
  })
})
