import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as cartModule from '../../src/cart.js'

const { addItem, createCart } = cartModule

test('countItems adds up the quantity of every item', () => {
  const cart = addItem(addItem(createCart(), { sku: 'PEN', name: 'Pen', price: 1500, qty: 2 }), { sku: 'CUP', name: 'Cup', price: 4000, qty: 3 })

  assert.equal(cartModule.countItems(cart), 5)
})

test('an empty cart counts 0', () => {
  assert.equal(cartModule.countItems(createCart()), 0)
})
