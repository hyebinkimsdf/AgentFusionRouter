const money = amount => `KRW ${amount.toLocaleString('en-US')}`

/** A plain-text receipt for a cart and its totals from calcTotal. */
export const formatReceipt = (cart, totals) =>
  [
    ...cart.items.map(i => `${i.name} x${i.qty}  ${money(i.price * i.qty)}`),
    '',
    `Subtotal: ${money(totals.subtotal)}`,
    `Discount: -${money(totals.discount)}`,
    `Tax: ${money(totals.tax)}`,
    `Total: ${money(totals.total)}`,
  ].join('\n')
