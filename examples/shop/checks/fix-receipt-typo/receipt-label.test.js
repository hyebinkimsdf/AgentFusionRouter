import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addItem, createCart } from '../../src/cart.js'
import { formatReceipt } from '../../src/format.js'

test('the receipt labels the total correctly', () => {
  const cart = addItem(createCart(), { sku: 'PEN', name: 'Pen', price: 1500, qty: 1 })
  const receipt = formatReceipt(cart, { subtotal: 1500, discount: 0, tax: 150, total: 1650 })

  assert.match(receipt, /^Total: KRW 1,650$/m)
  assert.doesNotMatch(receipt, /Totla/)
})
