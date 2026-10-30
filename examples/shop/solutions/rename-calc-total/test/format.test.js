import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addItem, calculateTotal, createCart } from '../src/cart.js'
import { formatReceipt } from '../src/format.js'

test('the receipt lists each item and the subtotal', () => {
  const cart = addItem(createCart(), { sku: 'PEN', name: 'Pen', price: 1500, qty: 2 })
  const receipt = formatReceipt(cart, calculateTotal(cart))

  assert.match(receipt, /Pen x2 {2}KRW 3,000/)
  assert.match(receipt, /Subtotal: KRW 3,000/)
})
