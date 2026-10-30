import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as cartModule from '../../src/cart.js'

// Accepts either name, so this check stays independent of the rename task.
const total = cartModule.calculateTotal ?? cartModule.calcTotal
const { addItem, createCart, useCoupon } = cartModule

test('a coupon is applied once, and tax is charged on the discounted amount', () => {
  const cart = useCoupon(addItem(createCart('KR'), { sku: 'BAG', name: 'Bag', price: 10000, qty: 1 }), 'WELCOME10')

  assert.deepEqual(total(cart), { subtotal: 10000, discount: 1000, tax: 900, total: 9900 })
})

test('a larger coupon in another region', () => {
  const cart = useCoupon(addItem(createCart('US'), { sku: 'BAG', name: 'Bag', price: 5000, qty: 2 }), 'VIP20')

  assert.deepEqual(total(cart), { subtotal: 10000, discount: 2000, tax: 640, total: 8640 })
})
