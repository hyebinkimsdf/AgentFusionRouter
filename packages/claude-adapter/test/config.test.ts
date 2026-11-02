import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { readConfig } from '../src/config.ts'

describe('readConfig', () => {
  test("each tier's effort defaults to the tier's own", () => {
    const { tiers } = readConfig({}).policy

    assert.deepEqual(tiers, { light: { model: 'haiku', effort: 'low' }, standard: {}, heavy: { model: 'opus', effort: 'high' } })
  })

  test("a tier's effort can be set, and an empty model keeps the session's", () => {
    // Every tier at low on the session's model: a fixed-effort benchmark arm.
    const { tiers } = readConfig({ strategy: 'effort', lightModel: '', heavyModel: '', lightEffort: 'low', standardEffort: 'low', heavyEffort: 'low' }).policy

    assert.deepEqual(tiers, { light: { effort: 'low' }, standard: { effort: 'low' }, heavy: { effort: 'low' } })
  })

  test('an effort that is not a level is ignored', () => {
    const { tiers } = readConfig({ standardEffort: 'turbo', heavyEffort: '' }).policy

    assert.deepEqual(tiers.standard, {})
    assert.equal(tiers.heavy.effort, 'high')
  })
})
