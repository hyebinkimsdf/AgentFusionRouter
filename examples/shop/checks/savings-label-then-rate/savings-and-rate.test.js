import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addItem, createCart } from '../../src/cart.js'
import * as formatModule from '../../src/format.js'

test('the receipt calls the discount "Savings"', () => {
  const cart = addItem(createCart(), { sku: 'PEN', name: 'Pen', price: 1500, qty: 1 })
  const receipt = formatModule.formatReceipt(cart, { subtotal: 1500, discount: 300, tax: 120, total: 1320 })

  assert.match(receipt, /^Savings: -KRW 300$/m)
  assert.doesNotMatch(receipt, /Discount:/)
})

test('formatRate turns a rate into a whole percent off', () => {
  assert.equal(formatModule.formatRate(0.15), '15% off')
  assert.equal(formatModule.formatRate(0.3), '30% off')
  assert.equal(formatModule.formatRate(0.333), '33% off')
})
