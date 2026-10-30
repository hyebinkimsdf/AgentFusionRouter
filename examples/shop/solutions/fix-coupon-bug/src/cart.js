import { applyCoupon, applyTax } from './pricing.js'

/** An empty cart for a region. Carts are never mutated: every change returns a new one. */
export const createCart = (region = 'KR') => ({ region, items: [], coupon: undefined })

/** Adds an item `{ sku, name, price, qty }`; the same SKU again raises its quantity. */
export const addItem = (cart, item) => {
  const existing = cart.items.find(i => i.sku === item.sku)
  const items = existing
    ? cart.items.map(i => (i.sku === item.sku ? { ...i, qty: i.qty + item.qty } : i))
    : [...cart.items, { ...item }]

  return { ...cart, items }
}

export const useCoupon = (cart, coupon) => ({ ...cart, coupon })

export const subtotalOf = cart => cart.items.reduce((sum, i) => sum + i.price * i.qty, 0)

/** Subtotal, discount, tax and total. Tax is charged on the discounted amount. */
export const calcTotal = cart => {
  const subtotal = subtotalOf(cart)
  const taxable = applyCoupon(subtotal, cart.coupon)
  const tax = applyTax(taxable, cart.region)

  return { subtotal, discount: subtotal - taxable, tax, total: taxable + tax }
}
