# Shop task set

A small cart and pricing library with six tasks for the benchmark, one or two per router tier.

| Task | Kind | Expected tier | Judged by |
|---|---|---|---|
| `find-tax-rate` | lookup | light | the answer names `src/pricing.js` |
| `fix-receipt-typo` | mechanical | light | the receipt prints `Total:` |
| `rename-calc-total` | mechanical, project-wide | standard | `calculateTotal` exported, `calcTotal` nowhere in `src/` or `test/` |
| `add-remove-item` | implement | standard | `removeItem` removes, ignores unknown SKUs, never mutates |
| `fix-coupon-bug` | debug | standard | a coupon is applied once, tax on the discounted amount |
| `tax-rule-registry` | design | heavy | `registerTaxRule` works, KR and US unchanged, JP rounds down |

- `project/` is what the agent works on. Its own tests pass: the problems show only under the hidden checks.
- `checks/<task>/` holds the hidden tests, copied in after the agent finishes.
- `solutions/<task>/` holds reference solutions, used only by `bench validate`.

These tasks exist to exercise the pipeline and to show the report. They are small enough that every model may solve them. See [benchmarks/README.md](../../benchmarks/README.md) for what that means for results.
