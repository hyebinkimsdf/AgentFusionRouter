import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyCoupon, applyTax } from '../src/pricing.js'

test('a coupon takes its percentage off', () => {
  assert.equal(applyCoupon(10000, 'WELCOME10'), 9000)
  assert.equal(applyCoupon(10000, 'VIP20'), 8000)
})

test('an unknown coupon takes nothing off', () => {
  assert.equal(applyCoupon(10000, 'NOPE'), 10000)
  assert.equal(applyCoupon(10000, undefined), 10000)
})

test('tax follows the region', () => {
  assert.equal(applyTax(1000, 'KR'), 100)
  assert.equal(applyTax(1000, 'US'), 80)
})

test('an unknown region is an error', () => {
  assert.throws(() => applyTax(1000, 'ZZ'))
})
