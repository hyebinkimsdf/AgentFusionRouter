# Changelog

## 0.1.0 (unreleased)

First release, Claude Code only.

- Observe mode (default): records each model request, turn, and subagent start with real token counts, and what the router would have done.
- Route mode (opt-in):
  - Confident light tasks go to the light model at low effort.
  - Ordinary work keeps the session's model.
  - Heavy work and escalations go to the heavy model, never below the session's own.
- Escalation: two consecutive failed test, build, or lint commands move the rest of a turn up one tier, once per turn by default. A "still failing" reply moves the next turn up.
- Cache guard: no switching down when the context exceeds 50K tokens.
- Subagent routing: confident light subagent tasks start on the light model. An explicit model is kept.
- `/router` and `/router explain <task>` commands.
- CLI: `agent-fusion-router report | explain | doctor`. `report --html <file> --png <file>` also writes a web page and a full-page screenshot.
- Benchmark: `agent-fusion-router bench validate | run | report | verify`.
  - Runs every task in every arm through `claude -p` in a fresh copy of the project, with a spending cap per run, and judges each run with hidden tests.
  - Writes a run folder with every raw file, `evidence.sha256`, a web report, and a screenshot that prints the data hash.
  - `verify` re-hashes every file and recomputes every figure.
  - `--simulate` exercises the pipeline without calling a model, and marks its output as simulated.
- Example task set `examples/shop`: six tasks from light to heavy, with hidden checks and reference solutions.
- `bench compare <a> <b>`: two runs side by side as a page and a screenshot, each verified, with every cost reconciled against Claude Code's total.
- `bench index`: every run and comparison in `benchmarks/index.html`, with screenshots, verification, and links to Claude Code's own output.
- Each run also writes `work.html` and its screenshot: every session's code change and final answer, task by task, the arms side by side, with the model that did the work. The report groups results by model too.
- Arms can start in another permission mode, add permission rules, and `planThenExecute`. That runs a task as a person uses opusplan: plan mode first, then the same session resumed with the plan approved.
- `bench run --max-total-usd <usd>`: stops before a run whose whole cap would not fit in the total, counted as Claude Code's computed cost of every session, invalid ones included. A session with no reported cost counts at its whole cap. Every run keeps the full `--budget`, so the total never cuts a run short. Claude Code checks its cap between requests, so the total can be passed by one run's last request.
- Reports show *What the run used*, and the index *All sessions, invalid included*: Claude Code's computed cost of every session, apart from the performance figures, which leave invalid runs out.
- `benchmarks/excluded/`: runs kept as evidence but left out of the index and comparisons, with notes outside their hashed folders.

### Changed

- Reports keep three cost figures apart. The *plugin estimate* is per request, from the tokens the plugin sees. *Claude Code's computed session cost* (`total_cost_usd`) is Claude Code's own figure, used by every comparison. The *billed cost* is in the provider's console and not measured.
- Reports show the signed **difference = Claude Code computed − plugin estimate**, per arm and per run. It is not explained by cause and is not called "accounted for": it mixes requests the plugin does not see with estimation error, and zero only shows the totals are consistent.
- Tokens outside the conversation are shown as observed counts from Claude Code's own output, with no claim about what they were for.
- The **price table check** compares this project's table with Claude Code's per-model figures, model by model.
- A session with no reported cost is *unknown*, never counted as $0 or replaced by the plugin's estimate.
- New like-for-like figure: session cost over the tasks every arm completed.
- Pages show plugin estimates with the current price table. Where a run was recorded with an earlier one, the page says so and lists recorded against current. The recorded files are unchanged and still verify.

### Fixed

- Cost estimates priced cache writes at the 5-minute rate (1.25× input). Claude Code writes with the 1-hour TTL (2× input), so estimates read about 25% low on a measured run. They now match Claude Code's per-model cost exactly.
- Sonnet 5.5 cache reads were priced at $0.20/MTok; they cost $0.10 (0.05× input, like Opus 5.5). The benchmark's cost reconciliation caught it: every Sonnet run was off and every Opus and Haiku run matched. Every price in the catalog has been rechecked against the official pricing page.
- An answer naming a path with Windows separators (`src\pricing.js`) failed the answer check.
- Each benchmark run now saves its price table (`prices.json`). `verify` recomputes older runs with the table they were made with.
- The usage log kept writing a day's records into the next day's file once the UTC date rolled over, so a record could be read back twice.
- A benchmark run that timed out was left out of the success rate and cost entirely, instead of counting as a failure; a run that exited with a non-zero code but still printed parseable JSON (`{}`) was counted as a normal result. Both are now reflected: a timeout is a counted failure, a non-zero exit is an invalid run.
- A session that hit the account's usage limit was scored as a failed task. In one run, 11 of 18 sessions ended on "You've hit your 5-hour limit" before any model answered, and the report counted them as failures (6/18 instead of 6/7). A session that ends on an API error is now invalid, with every API error Claude Code reported as the reason. A usage or rate limit (HTTP 429) in any of a session's invocations stops `bench run`: the runs made are written and verified, and the report and index mark the run *Stopped early*. That run is now in `benchmarks/excluded/`.
- A plan-then-execute run whose plan ended in an error (an API error, a spent budget, a crash) still had its plan approved and executed, spending on a run that could not count. It now ends with the plan.
- A run stopped by its `--max-budget-usd` cap fell under "any non-zero exit is invalid" and could be left out of the figures. It is now identified by Claude Code's `subtype: "error_max_budget_usd"` and counted as a failure, like a timeout. Other non-zero exits stay invalid.
- A run moved out of `benchmarks/results/` lost two protections for its hashed evidence. Git ignored its `run.log`, and Git could convert its line endings. `benchmarks/excluded/` now keeps both, as `results/` does.
- The index counted invalid runs in the success denominator. It now shows successes out of valid runs, and how many were invalid.
- A run that did not reach every task wrote a `results.json` that `verify` then rejected, because it summarized tasks with no runs. It now summarizes the tasks that ran, as `verify` and the report do.
- A failure follow-up ("still failing, now redesign the whole auth system") was capped at one tier above the *previous* task, so a harder new request inside the same failure reply could be routed below what it needed. It now routes at whichever is higher.
- A verification command was recognized by substring match alone, so `echo npm test` counted as a test run, and the pass/fail came from the whole shell line's exit code, so `npm test || true` (always exits 0) and `npm test; cleanup` (exits with `cleanup`'s code) recorded the wrong result. A command now verifies only when the check is the last one in its chain, which is what the exit code actually reports.
