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
