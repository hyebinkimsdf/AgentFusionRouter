# Excluded runs

Runs kept as evidence but left out of [`index.html`](../index.html) and of every comparison. Each folder is exactly as the run left it. Notes about a run go in this file, not in its folder: a file that `evidence.sha256` does not list fails verification.

## 20261030-100520

Six tasks × three arms (`default`, `opusplan`, `auto`) × one repetition, live, Claude Code 2.1.312, repository commit `c9428e5`. Excluded on 2026-11-02.

**Why it is excluded.** The account's 5-hour usage limit was reached during the run. 11 of 18 sessions ended on "You've hit your 5-hour limit" (`terminal_reason: "api_error"`, `api_error: "usage_limit_reached"`, HTTP 429) before doing the task: `add-remove-item`, `fix-coupon-bug` and `tax-rule-registry` in every arm, and `rename-calc-total` in `auto` and `opusplan`. The runner at that commit scored them as failed tasks, so the folder's `report.html`, `report.png` and `results.json` show **6/18** successes. That figure is wrong.

**Recomputed from the raw files with the current runner:** 6 successes out of 7 valid runs, 11 invalid (`default` 3/3, `opusplan` 1/2, `auto` 2/2). Only `find-tax-rate` and `fix-receipt-typo` ran in every arm, which is too little to compare the arms. The one genuine failure: `fix-receipt-typo × opusplan` changed `Totla: ` to `Total:`, dropping the space, and the hidden test caught it.

**What it cost**, by Claude Code's computed session cost (`total_cost_usd`, list prices, not a bill):

| Sessions | Claude Code computed |
|---|---:|
| 7 valid | $0.56525694 |
| 11 invalid | $0.07601380 |
| All 18 | $0.64127074 |

All of the invalid cost comes from `rename-calc-total × opusplan`. Its plan phase spent $0.076 on Opus and then hit the limit on its second turn. The execute phase that followed hit the limit again. The current runner no longer executes a plan that ended in an error, and it stops at the first usage limit.

**Verification.** The files are unchanged: `sha256sum -c evidence.sha256` and `sha256sum -c report.sha256` pass in the folder, and the data hash is `babf575f80756ffba4bca884283f07472384e9ec117346fad62823f0bf5427bf`. `bench verify benchmarks/excluded/20261030-100520` reports 12 problems of the form `runs/<task>__<arm>__r1/result.json does not match its raw files`. Eleven of those files were derived by the runner at `c9428e5`, which did not mark these sessions invalid. Recomputed from the same raw files, they are invalid. The twelfth, `fix-receipt-typo × opusplan`, recorded the router tier as `standard`. That tier was read from the execute phase's log, because the runner read the plan's and the execute's log files in name order, which is not time order. Read in time order, the plan's decision is `light`, the task's expected tier. So the matching hashes show the files are unchanged, and the failed verification shows that the old derivation differs from the current one. Both results are expected.

**Use.** Error analysis: what a usage limit looks like in Claude Code's output, and how the runner treated it. The regression tests in [`bench.test.ts`](../../packages/cli/test/bench.test.ts) use this output.
