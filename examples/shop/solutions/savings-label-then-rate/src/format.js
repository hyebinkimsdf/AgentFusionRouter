const money = amount => `KRW ${amount.toLocaleString('en-US')}`

/** A plain-text receipt for a cart and its totals from calcTotal. */
export const formatReceipt = (cart, totals) =>
  [
    ...cart.items.map(i => `${i.name} x${i.qty}  ${money(i.price * i.qty)}`),
    '',
    `Subtotal: ${money(totals.subtotal)}`,
    `Savings: -${money(totals.discount)}`,
    `Tax: ${money(totals.tax)}`,
    `Totla: ${money(totals.total)}`,
  ].join('\n')

/** A discount rate as text: 0.15 is "15% off", rounded to a whole percent. */
export const formatRate = rate => `${Math.round(rate * 100)}% off`
