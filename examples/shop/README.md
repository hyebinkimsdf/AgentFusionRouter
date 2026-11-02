# Shop task set

A small cart and pricing library with eight tasks for the benchmark. Two of them add a follow-up turn of another tier in the same session, so a routed run switches model or effort mid-conversation.

| Task | Kind | Expected tier | Judged by |
|---|---|---|---|
| `find-tax-rate` | lookup | light | the answer names `src/pricing.js` |
| `fix-receipt-typo` | mechanical | light | the receipt prints `Total:` |
| `rename-calc-total` | mechanical, project-wide | standard | `calculateTotal` exported, `calcTotal` nowhere in `src/` or `test/` |
| `add-remove-item` | implement | standard | `removeItem` removes, ignores unknown SKUs, never mutates |
| `fix-coupon-bug` | debug | standard | a coupon is applied once, tax on the discounted amount |
| `tax-rule-registry` | design | heavy | `registerTaxRule` works, KR and US unchanged, JP rounds down |
| `count-items-then-locate` | implement, then lookup | standard → light | `countItems` sums quantities, and the last answer names `src/cart.js` |
| `savings-label-then-rate` | mechanical, then implement | light → standard | the receipt prints `Savings:`, and `formatRate(0.15)` is `15% off` |

- `project/` is what the agent works on. Its own tests pass: the problems show only under the hidden checks.
- `checks/<task>/` holds the hidden tests, copied in after the agent finishes.
- `solutions/<task>/` holds reference solutions, used only by `bench validate`.

These tasks exist to exercise the pipeline and to show the report. They are small enough that every model may solve them. See [benchmarks/README.md](../../benchmarks/README.md) for what that means for results.
