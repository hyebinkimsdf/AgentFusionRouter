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
- `codex`: a Codex thread routed turn by turn, over `codex app-server`. Only turns started through it are routed, never the Codex app's own.
  - Observe mode by default. `--mode route` changes effort on your model; `--strategy model` also moves light work to Luna and heavy work to Astra.
  - Codex keeps the model and effort a turn sets for every later turn. So your setting (what `thread/start` reports) and the thread's current one are kept apart, and standard work returns to yours.
  - Only models and efforts that `model/list` reports are sent.
  - Past the cache guard, a move to a smaller model or a lower effort is held. Codex's cache did not survive an effort change in two observations on Codex 0.164, unlike Claude Code's.
  - A failed verification raises the next turn's tier. Retrying a failed turn on its own is not built yet.
  - Usage comes from `thread/tokenUsage/updated`, one per request, matching the rollout records. Repeats are skipped.
  - Each request and turn is recorded to `~/.agent-fusion-router/codex-logs`, apart from the plugin's logs.
  - At start it says whether turns draw on a ChatGPT plan's limits (and how much is used) or are billed per token on an API key. Approvals are asked in the terminal, and Ctrl+C stops a turn.
- Effort per tier: `lightEffort`, `standardEffort`, `heavyEffort` (defaults `low`, the session's, `high`). With `strategy: effort` and every tier at `low`, the plugin runs a session at a fixed low effort.
- `benchmarks/arms.effort.json`: Opus at its session effort, at a fixed low effort, with effort routing alone, and with model routing. It asks whether switching models adds anything over changing effort.
- Follow-up turns in a task (`followUps`): each resumes the same session with its own expected tier, and the check judges the state after the last one. Single-turn tasks never switch model or effort mid-conversation, so the shop set adds two tasks that do, from standard to light and from light to standard.
- The plugin logs each request's effort before routing and as sent. Bench reports add, per arm: the cache read ratio over summed tokens, what each run's first request read and wrote (a cold prefix depends on what ran before), the requests right after a model or effort change with their cache reads and writes, requests cut at the output cap (`max_tokens`) and whether those runs still passed, and the efforts asked for and sent. Runs made before these were logged show them as not logged, and still verify.
- `codex-usage`: a per-request token ledger from Codex's own session records (`CODEX_HOME`, else `~/.codex`; archived sessions included), read-only and with no message text kept.
  - Each request (`token_usage_record`) is counted once, by its id, across files.
  - Codex's running total (`token_count`) is compared interval by interval. It enters the ledger only where records are missing or short, marked as estimated.
  - Auto-compaction requests, which the running total leaves out (openai/codex#47003, seen here on Codex 0.164 as 254,923 tokens in one session), are counted as their own row.
  - Compaction events with no request behind them are reported, not counted: copied from a parent thread, or from a Codex version that recorded none.
  - Every difference from the running total is reported by cause, with what is left *Unaccounted*.
  - The ledger holds token counts only; the costs below are a layer on top of it.
- Codex costs and a routing simulation, in `codex-usage` and in `report` (which now adds Codex's usage after the plugin's; `--no-codex` leaves it out).
  - Costs use OpenAI's API list prices (`CODEX_MODELS`, as of 2026-11-02). They are labelled as such: on a ChatGPT plan they are never what was paid.
  - The simulation sends each turn's prompt through the same `analyzeTask` and `route` as the Claude Code plugin, cache guard included. Light goes to Luna and heavy to Astra; standard keeps the turn's model, or `--standard-model sol` sends it to Sol.
  - It prices the same tokens at the routed model, with a switched turn's first request read from a cold cache. *Potential savings* is labelled a simulation, not a saving that happened.
  - Prompts are read in memory and only the analysis is kept. The VS Code extension's IDE context and Codex's injected context blocks are left out. A turn with no `user_message` event (Codex 0.164 and 0.165) takes its prompt from the user message item.
- VS Code extension (`packages/vscode`): one status bar entry with Claude's savings estimate (or its potential, in observe mode) and Codex's potential savings, for today, the last 7 days or the last 30 days.
  - The entry and its hover name each figure's basis: API list prices, and an estimate or a simulation. Clicking it opens the full report, with the same text as `report` and `codex-usage`, in a page that runs no script.
  - Only the plugin's logs and Codex's session records are read. A file is read again only when it changed, and one last written before the period is skipped. Nothing is written or sent.
  - Korean or English, following VS Code. Folders can be set for WSL, and `agentFusionRouter.codexStandardModel` simulates another Codex policy.
  - `npm run vscode:install` installs it from the repository, since it is not on the marketplace.
- The usage report states both Claude savings figures with their basis: *Routing savings estimate* (API list prices, same tokens; not a measured saving) and *Potential savings if routed* (API list prices, simulation).
- The plugin also logs Claude Code's own computed cost as it grows (`cost` records). The usage report shows it beside the per-request estimate, and the difference as *Not in the per-request estimates*: background requests, compaction, web search, and cache write rates. Each record keeps its growth, so a `--since` period counts only its own spend.
- The core's model families include Codex's (Luna < Terra < Sol < Astra), matched only as a whole part of a model id. An unknown model such as `my-console-model` stays unknown, and is never switched away from.

### Changed

- Reports keep three cost figures apart. The *plugin estimate* is per request, from the tokens the plugin sees. *Claude Code's computed session cost* (`total_cost_usd`) is Claude Code's own figure, used by every comparison. The *billed cost* is in the provider's console and not measured.
- Reports show the signed **difference = Claude Code computed − plugin estimate**, per arm and per run. It is not explained by cause and is not called "accounted for": it mixes requests the plugin does not see with estimation error, and zero only shows the totals are consistent.
- Tokens outside the conversation are shown as observed counts from Claude Code's own output, with no claim about what they were for.
- The **price table check** compares this project's table with Claude Code's per-model figures, model by model.
- A session with no reported cost is *unknown*, never counted as $0 or replaced by the plugin's estimate.
- New like-for-like figure: session cost over the tasks every arm completed.
- The task analyzer, for Claude Code and Codex alike, reads three kinds of message differently. Labelled by hand, 48 real Codex turns matched the analyzer's tier 9 times before and 31 after; the labels were made while writing these rules, so an independent set is still needed.
  - **Pasted material with a request for a check** ("아래처럼 진행했는데 확인해줘", or a report followed by "해당 내용 어떻게 생각해?") is a `review`, judged by the person's own words around the paste and at least `standard`. The paste's words (design, security, deployment) no longer make it heavy. A long message that asks for work is still read whole.
  - **Short questions** ("좋을까?", "아니잖아", "what do you think") are a `question`, and light unless a heavier signal is present. A bare "좋을까" is no longer a design trade-off, and a Korean "왜" counts as investigation only next to a failure.
  - **Answer-only requests** ("수정하지 말고 의견만", "don't change anything") do not count implementation words as work.
- Pages show plugin estimates with the current price table. Where a run was recorded with an earlier one, the page says so and lists recorded against current. The recorded files are unchanged and still verify.

### Fixed

- Cost estimates priced cache writes at the 5-minute rate (1.25× input). Claude Code writes with the 1-hour TTL (2× input), so estimates read about 25% low on a measured run. They now match Claude Code's per-model cost exactly.
- Sonnet 5.5 cache reads were priced at $0.20/MTok; they cost $0.10 (0.05× input, like Opus 5.5). The benchmark's cost reconciliation caught it: every Sonnet run was off and every Opus and Haiku run matched. Every price in the catalog has been rechecked against the official pricing page.
- An answer naming a path with Windows separators (`src\pricing.js`) failed the answer check.
- A run's plugin records were read in log-file name order. Each invocation of a session (a plan's approval, a follow-up turn) logs to a file of its own, and the names do not sort by time. So the router tier of a plan-then-execute or multi-turn run could come from a later invocation. One opusplan run in `benchmarks/excluded/` recorded `standard` where the plan decided `light`. Records are now read in time order.
- The README gave auto routing's cost in run `20261030-092454` as about 52% of Opus-fixed's. $0.378 ÷ $0.791 is 47.8%: about 48% of the cost, 52% less.
- A Codex turn whose prompt came from the user message item could be analyzed from the project's AGENTS.md, which Codex injects as a user message of its own (`# AGENTS.md instructions for <dir>`), instead of the person's request. It is now left out with the other injected context.
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
