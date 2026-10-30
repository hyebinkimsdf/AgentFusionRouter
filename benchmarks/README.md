# Benchmarks

Routing saves money only if the cheaper model still finishes the job. A light model that needs two retries and a human fix costs more than a heavy model that gets it right once. This benchmark measures cost per **completed** task, not per request.

## Arms

[`arms.json`](arms.json) defines what is compared. Each arm is a session model plus the plugin's settings:

| Arm | Session model | Plugin | What it answers |
|---|---|---|---|
| `default` | the account's default (no `--model`) | observe | Claude Code as it comes |
| `opusplan` | `opusplan`, plan then execute | observe | Claude Code's own phase-based switch, used as a person uses it: Opus plans, Sonnet executes |
| `auto` | the account's default | route, standard tier → `sonnet` | This router: light tasks to Haiku, ordinary work to Sonnet, heavy work and escalations to Opus |

`default` and `auto` start from the same model, so the router is the only difference between them. The arms that do not route run the plugin in observe mode. It changes nothing there, but it records what it would have chosen, so every arm logs the same fields. The `auto` arm sets the standard tier to Sonnet; without that, ordinary work would stay on the session model.

**opusplan, plan then execute.** opusplan uses Opus only in plan mode. A person enters plan mode, reads the plan and approves it, and Sonnet carries it out in the same conversation. A `claude -p` session offers no tool to approve a plan, so `planThenExecute` runs this in two invocations of one session. The first runs in plan mode on the task. The second resumes it (`--resume`) in `acceptEdits` mode with "Your plan is approved. Implement it now." Both invocations are saved in `claude.json`. The second's `total_cost_usd` and `modelUsage` already include the first, so the totals come from it, while the conversation's tokens are summed over both. These arms keep their sessions in Claude Code's history, because a resume needs one. Run [`20261030-092454`](results/20261030-092454/report.html) started opusplan in `acceptEdits` mode instead: it never entered plan mode and ran on Sonnet alone.

[`arms.fixed-models.json`](arms.fixed-models.json) compares fixed Opus, fixed Sonnet, and routing instead: `--arms benchmarks/arms.fixed-models.json`.

## Tasks

A task set is a folder:

```
examples/shop/
  tasks.json     the tasks: id, kind, expected tier, prompt, optional answerIncludes
  project/       the starting code; each run gets a fresh copy
  checks/<id>/   hidden tests, copied into test/hidden/ after the agent finishes
  solutions/<id>/  reference solutions, used only to prove the checks are sound
```

A run succeeds when the whole test suite passes with the hidden tests added, and, for a question, the final answer contains every `answerIncludes` string. The agent never sees `checks/` or `solutions/`: it works in a copy of `project/` in the system temp folder.

`bench validate` runs every check twice: on the untouched project, where it must fail, and with the reference solution, where it must pass. `bench run` does this first and refuses to start if any check is unsound.

## Running

```bash
npm run build
node packages/cli/dist/cli.js bench validate
node packages/cli/dist/cli.js bench run --simulate           # no model called: checks the pipeline
node packages/cli/dist/cli.js bench run --task find-tax-rate --arm auto --budget 0.2   # one cheap live run
node packages/cli/dist/cli.js bench run --reps 3             # the full comparison
```

Each live run calls:

```
claude -p --output-format json --model <arm model> --plugin-dir plugins/claude/agent-fusion-router
       --settings <file> --setting-sources project --strict-mcp-config --no-session-persistence
       --permission-mode acceptEdits --max-budget-usd <budget>
```

The prompt goes on stdin. The settings file carries the arm's plugin options and allows only the test runner (`node --test`, `npm test`) among shell commands. Your own settings, plugins, and MCP servers are not loaded, so every arm runs in the same environment. Arms run in a rotated order per task, so no arm always goes first.

**Live runs cost money or plan usage.** The full shop comparison is 6 tasks × 3 arms × repetitions. `--budget` caps each run (default $1), and `--timeout` limits its time (default 15 minutes).

If the plugin records nothing in a routing arm, the run is marked invalid: routing did not happen, so its numbers say nothing about routing. Invalid runs are listed in the report and left out of every figure.

## What a run leaves

`benchmarks/results/<run id>/`:

| File | Contents |
|---|---|
| `run.json` | Environment (Claude Code version, Node, OS, repository commit, plugin bundle hash), task set hash, check validation |
| `tasks.json`, `arms.json` | Exactly what was run |
| `prices.json` | The price table the plugin estimates were made with, so they recompute the same after prices change |
| `run.log` | The console output |
| `runs/<task>__<arm>__r<n>/` | `prompt.txt`, `settings.json`, `claude.json` (Claude Code's own report), `claude.stderr.txt`, `plugin-logs/`, `check.json` and `check.txt`, `diff.patch` and `diff.numstat`, `meta.json` (wall time, exit code), `result.json` |
| `results.json` | The figures in the report |
| `evidence.sha256` | SHA-256 of every file above, in `sha256sum` format |
| `report.html`, `report.png` | The web report and a full-page screenshot of it |
| `report.sha256` | SHA-256 of the report and the screenshot |

## Verifying a run

The report and its screenshot print the **data hash**: the SHA-256 of `evidence.sha256`. A screenshot can then be matched to the exact files it was made from:

```bash
cd benchmarks/results/<run id>
sha256sum -c evidence.sha256        # every raw file is unchanged
sha256sum evidence.sha256           # equals the data hash on the report
sha256sum -c report.sha256          # the report and screenshot are unchanged
cd -
node packages/cli/dist/cli.js bench verify benchmarks/results/<run id>
```

`bench verify` also recomputes each `result.json` from its raw files and `results.json` from the per-run results, and fails if any figure differs. Committing the run folder to Git adds a public timestamp. `.gitattributes` keeps Git from changing line endings in results, which would change their hashes.

The report also checks itself:

- **Cost reconciliation:** three figures are kept apart. The *plugin estimate* is the plugin's per-request estimates, from the tokens it sees, priced with this project's table. *Claude Code's computed session cost* (`total_cost_usd`) is Claude Code's own figure at list prices. The *billed cost* is in the provider's billing console and is not measured here. The report shows **difference = Claude Code computed − plugin estimate**, signed. The difference mixes requests the plugin does not see with estimation error, double counting and timing, and this data cannot split it by cause. A zero difference shows arithmetic consistency, not that each request was estimated right.
- **Tokens outside the conversation:** observed in Claude Code's own output, as its per-model totals (`modelUsage`) less the conversation's (`usage`). What those requests were for is not recorded.
- **Price table check:** prices Claude Code's per-model token counts with this project's table and compares each with Claude Code's per-model figure (`costUSD`). This tests the table against Claude Code's computation, not against a bill.
- **Classifier accuracy:** the router's tier against each task's expected tier, counted over every arm.

### Comparing two runs

```bash
node packages/cli/dist/cli.js bench compare benchmarks/results/<a> benchmarks/results/<b> --label-a "Before" --label-b "After"
```

This writes `benchmarks/comparisons/<a>_vs_<b>/` with a page (`comparison.html`), its screenshot (`comparison.png`), and their hashes (`comparison.sha256`). The page verifies both runs and shows them side by side: each run's data hash and verification status, then per task the cost reconciliation and the tokens. Figures are recomputed from the raw files, so an older run shows everything the current release derives.

The first comparison, [`20261030-085716_vs_20261030-090443`](comparisons/20261030-085716_vs_20261030-090443/comparison.png), records a fix found by the price table check. Before it, the table priced cache writes at the 5-minute rate, but Claude Code's own output reported 1-hour writes (`cacheCreationEphemeral1hInputTokens`), so the estimate came up short by $0.00050123 (−24.5%). After it, the table agrees with Claude Code's per-model figures. The same check later found Sonnet 5.5 cache reads priced at $0.20/MTok instead of $0.10. Both were confirmed on the official pricing page before the table changed.

**Calibration runs and evaluation runs.** Runs `20261030-085716`, `20261030-090215`, `20261030-090443` and `20261030-092454` were used to find and correct the price table. Judge the table's accuracy on later runs, not on the runs that tuned it. The 1-hour cache-write rate is an assumption the plugin makes, because a request's usage reports no TTL. It matches what Claude Code reported in these runs, but it remains an estimate. The comparison figures use Claude Code's computed cost and do not depend on it.

## Measures

| Measure | Source |
|---|---|
| Success | hidden tests and answer check, run by the benchmark after the agent finishes |
| Cost per completed task | Claude Code's computed session cost (`total_cost_usd`) summed over an arm's runs ÷ its successes; failed runs count. A run with no reported cost is unknown, never $0 |
| Cost on the tasks all arms completed | the same session cost over only the tasks every arm passed: a like-for-like figure |
| Tokens | input, output, cache read, cache write, from Claude Code's `modelUsage` |
| Time | wall clock around `claude -p` |
| Turns, permission denials | Claude Code's report |
| Escalations, router tier | the plugin's records |
| Lines changed | `git diff --numstat` against the starting copy |

Costs are Claude Code's computed figures at list prices, not a bill. On a subscription the same work counts against plan limits instead. Context compaction is not separated: these sessions are short, and its tokens would show only as part of the totals.

## Limits to state with any result

- **The shop tasks are small.** Every model may solve all of them, and then the comparison only shows cost. Real conclusions need larger tasks from real repositories.
- **The tasks and the classifier rules have the same author.** That the router picks the expected tier on all six shop tasks is not evidence of accuracy. Score the classifier on tasks written by someone else.
- **Repeat.** Run at least three repetitions per task and arm; single runs vary too much to compare.
- **Simulated runs are not results.** `--simulate` invents its numbers with one rule (a model below the task's tier fails). Their folders end in `-simulated`, their reports say so in a banner, and Git ignores them.
