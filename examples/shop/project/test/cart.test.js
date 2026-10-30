import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addItem, calcTotal, createCart } from '../src/cart.js'

const pen = { sku: 'PEN', name: 'Pen', price: 1500, qty: 1 }

test('adding the same SKU raises its quantity', () => {
  const cart = addItem(addItem(createCart(), pen), { ...pen, qty: 2 })

  assert.equal(cart.items.length, 1)
  assert.equal(cart.items[0].qty, 3)
})

test('adding never changes the original cart', () => {
  const cart = createCart()
  addItem(cart, pen)

  assert.equal(cart.items.length, 0)
})

test('totals without a coupon add Korean tax', () => {
  const cart = addItem(createCart('KR'), { ...pen, qty: 2 })

  assert.deepEqual(calcTotal(cart), { subtotal: 3000, discount: 0, tax: 300, total: 3300 })
})
