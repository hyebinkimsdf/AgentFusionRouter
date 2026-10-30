import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as cartModule from '../../src/cart.js'

const { addItem, createCart } = cartModule
const pen = { sku: 'PEN', name: 'Pen', price: 1500, qty: 1 }
const cup = { sku: 'CUP', name: 'Cup', price: 4000, qty: 2 }

test('removeItem removes the item with that SKU', () => {
  const cart = addItem(addItem(createCart(), pen), cup)
  const after = cartModule.removeItem(cart, 'PEN')

  assert.deepEqual(after.items.map(i => i.sku), ['CUP'])
})

test('removing an unknown SKU returns an equal cart', () => {
  const cart = addItem(createCart(), pen)

  assert.deepEqual(cartModule.removeItem(cart, 'NOPE'), cart)
})

test('removeItem leaves the original cart unchanged', () => {
  const cart = addItem(addItem(createCart(), pen), cup)
  cartModule.removeItem(cart, 'PEN')

  assert.equal(cart.items.length, 2)
})
