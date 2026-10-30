// Amounts are whole currency units (won, cents) so totals never carry float error.

export const TAX_RATES = {
  KR: 0.1,
  US: 0.08,
}

export const COUPONS = {
  WELCOME10: 0.1,
  VIP20: 0.2,
}

/** The amount after the coupon's discount. An unknown or missing coupon takes nothing off. */
export const applyCoupon = (amount, coupon) => {
  const rate = COUPONS[coupon] ?? 0

  return Math.round(amount * (1 - rate))
}

/** The tax owed on an amount in a region, rounded to a whole unit. */
export const applyTax = (amount, region) => {
  const rate = TAX_RATES[region]
  if (rate === undefined) throw new Error(`No tax rule for region ${region}`)

  return Math.round(amount * rate)
}
