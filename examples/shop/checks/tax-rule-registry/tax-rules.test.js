import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as pricing from '../../src/pricing.js'

test('KR and US keep their results', () => {
  assert.equal(pricing.applyTax(1000, 'KR'), 100)
  assert.equal(pricing.applyTax(1005, 'US'), 80)
})

test('JP rounds 10% down to a whole unit', () => {
  assert.equal(pricing.applyTax(1099, 'JP'), 109)
})

test('a registered rule is used for its region', () => {
  pricing.registerTaxRule('XX', amount => amount * 2)

  assert.equal(pricing.applyTax(7, 'XX'), 14)
})

test('an unknown region is still an error', () => {
  assert.throws(() => pricing.applyTax(1000, 'ZZ'))
})
