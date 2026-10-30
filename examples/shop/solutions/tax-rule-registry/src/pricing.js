// Amounts are whole currency units (won, cents) so totals never carry float error.

export const COUPONS = {
  WELCOME10: 0.1,
  VIP20: 0.2,
}

/** Tax rules by region: each takes an amount and returns the tax owed on it. */
const taxRules = new Map()

/** Adds or replaces the tax rule for a region. */
export const registerTaxRule = (region, rule) => {
  taxRules.set(region, rule)
}

const rate = r => amount => Math.round(amount * r)

registerTaxRule('KR', rate(0.1))
registerTaxRule('US', rate(0.08))
registerTaxRule('JP', amount => Math.floor(amount * 0.1))

/** The amount after the coupon's discount. An unknown or missing coupon takes nothing off. */
export const applyCoupon = (amount, coupon) => {
  const discount = COUPONS[coupon] ?? 0

  return Math.round(amount * (1 - discount))
}

/** The tax owed on an amount in a region. */
export const applyTax = (amount, region) => {
  const rule = taxRules.get(region)
  if (rule === undefined) throw new Error(`No tax rule for region ${region}`)

  return rule(amount)
}
