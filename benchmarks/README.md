# Benchmarks

Routing saves money only if the cheaper model still finishes the job. A light model that needs two retries and a human fix costs more than a heavy model that gets it right once. This benchmark measures cost per **completed** task, not per request.

## Arms

[`arms.json`](arms.json) defines what is compared. Each arm is a session model plus the plugin's settings:

| Arm | Session model | Plugin | What it answers |
|---|---|---|---|
| `opus-fixed` | `opus` | observe | One high-capability model for everything |
| `sonnet-fixed` | `sonnet` | observe | One standard model for everything |
| `auto` | `opus` | route, standard tier → `sonnet` | Light tasks to Haiku, ordinary work to Sonnet, heavy work and escalations to Opus |

The fixed arms run the plugin in observe mode. It changes nothing there, but it records what it would have chosen, so every arm logs the same fields. The `auto` arm sets the standard tier to Sonnet. Without that, ordinary work would stay on the Opus session model and only two models would ever run.

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

- **Cost cross-check:** the plugin's estimate from its own records against Claude Code's `total_cost_usd`, per run. A large gap means the plugin missed requests.
- **Classifier accuracy:** the router's tier against each task's expected tier, counted over every arm.

## Measures

| Measure | Source |
|---|---|
| Success | hidden tests and answer check, run by the benchmark after the agent finishes |
| Cost per completed task | sum of Claude Code's `total_cost_usd` over an arm's runs ÷ its successes; failed runs count |
| Tokens | input, output, cache read, cache write, from Claude Code's `modelUsage` |
| Time | wall clock around `claude -p` |
| Turns, permission denials | Claude Code's report |
| Escalations, router tier | the plugin's records |
| Lines changed | `git diff --numstat` against the starting copy |

Costs are at API list prices, as Claude Code computes them. On a subscription the same work counts against plan limits instead.

## Limits to state with any result

- **The shop tasks are small.** Every model may solve all of them, and then the comparison only shows cost. Real conclusions need larger tasks from real repositories.
- **The tasks and the classifier rules have the same author.** That the router picks the expected tier on all six shop tasks is not evidence of accuracy. Score the classifier on tasks written by someone else.
- **Repeat.** Run at least three repetitions per task and arm; single runs vary too much to compare.
- **Simulated runs are not results.** `--simulate` invents its numbers with one rule (a model below the task's tier fails). Their folders end in `-simulated`, their reports say so in a banner, and Git ignores them.
