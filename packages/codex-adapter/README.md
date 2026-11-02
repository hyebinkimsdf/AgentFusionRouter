# Codex adapter

Two parts: the usage ledger, and a routing runner for turns started through it (see [Routing runner](#routing-runner)).

## Usage ledger (implemented)

Reads Codex's own session records and builds a per-request token ledger. It only reads them, never writes, and needs no hook, plugin or proxy.

```bash
node packages/cli/dist/cli.js codex-usage                # this machine's Codex usage, reconciled
node packages/cli/dist/cli.js codex-usage --json         # the summary and every ledger entry
node packages/cli/dist/cli.js codex-usage --codex-home D:\codex
```

**Where it reads.** It reads `rollout-*.jsonl` under `sessions/` and `archived_sessions/` in Codex's home. The home is `CODEX_HOME`, or `~/.codex` when that is not set.

**What it reads.** It reads token counts, request and turn ids, model names, reasoning effort and timestamps. Message text is never kept in the ledger. Entries name their file relative to Codex's home.

**Two sources, kept apart.**

- `token_usage_record` lines report each model request once, with its id (`response_id`). The ledger is built from them. A request id seen before, in the same file or an earlier one, is dropped.
- `token_count` events carry Codex's running total. It is compared with the records, one interval at a time (the lines up to each total). It enters the ledger only where records are missing or short, as an entry marked `cumulative_delta`.

**How each interval reconciles.**

| Status | Records vs. the total's change | In the ledger |
|---|---|---|
| `matched` | equal | the records |
| `compaction_not_in_total` | more, by exactly the compaction requests' usage | the records |
| `unexplained_excess` | more, by anything else | the records; the excess is reported |
| `records_short` | less | the records, plus the shortfall from the total |
| `cumulative_only` | no records (a Codex version that wrote none) | the total's change |
| `total_reset` | the total went down | the records; the file is left out of the balance |
| `after_last_total` | records after the last total | the records, not yet compared |

Records and the total are never combined with `max()`. That would count the same usage twice.

**Auto-compaction.** A compaction request is written as a `token_usage_record`, but Codex leaves it out of the running total ([openai/codex#47003](https://github.com/openai/codex/issues/47003)). This was observed here on Codex 0.164 too. Such a request is the one whose `response_id` equals a `compacted` line's `compaction_response_id`. The ledger counts it as its own row, apart from the requests a router could choose.

Two kinds of `compacted` line have no record behind them, and neither is counted:

- one copied from a parent thread, which subagent and review threads start with;
- one written by a Codex version that recorded no compaction usage at all.

So a total that includes such a version is a lower bound.

**Token semantics.** These are Codex's own. `input` includes `cachedInput`, and `output` includes `reasoningOutput`; `total` is input + output. The core's Claude figures count input without cache reads, so a combined report must convert between the two.

**The balance.** The report checks this equation, and its *Unaccounted* figure is what is left over: zero when every difference is explained.

```
ledger − running total = compaction left out + unexplained excess + records after the last total
```

The ledger holds token counts only. Prices and the routing simulation are a separate layer on top of it.

## Costs and the routing simulation (implemented)

`codex-usage` and `report` price the ledger and simulate routing it. Every figure is labelled with its basis.

**API list prices.** Costs use OpenAI's API list prices (Standard tier), in `CODEX_MODELS` in [the core's catalog](../core/src/catalog.ts), checked on the date it gives. On a ChatGPT plan, Codex draws on plan limits and credits, so these figures are never what was paid. The pricing rules:

- uncached input, cached input and output are priced apart;
- reasoning is billed as output;
- a request past 272K input tokens is priced at the long-context row;
- cache writes are priced at the 30-minute rate, though no session read so far has written any.

**The simulation.** It asks what each turn would have cost had this router chosen its model.

- **Same router as Claude Code.** The prompt goes through the same `analyzeTask` and `route` as in the Claude Code plugin. That includes the confidence threshold, follow-ups and the cache guard (no move down past 50,000 tokens of context).
- **Tier targets.** Light goes to Luna, heavy to Astra, and standard keeps the turn's own model. `--standard-model sol` simulates the other common policy, ordinary work on Sol, as the benchmark's auto arm sends it to Sonnet.
- **How it is priced.** The turn's requests are priced at the routed model with the same token counts. A switched turn's first request reads its whole input uncached, because the new model's cache is cold. Auto-compaction stays on the model it ran on.
- **Which prompt is read.** The prompt is the turn's first `user_message`, or the first user `response_item` when there is none (seen on Codex 0.164 and 0.165). Context blocks Codex injects (`<environment_context>`, and a project's AGENTS.md as `# AGENTS.md instructions for <dir>`) are left out, and so is the IDE context the VS Code extension puts before `## My request:`.
- **What is kept.** The prompt is read in memory, and only the router's analysis (tier, kind, confidence, signal names) is kept.

**Potential savings** is actual minus simulated, at API list prices. It is a simulation, not a saving that happened. It assumes a smaller model uses the same tokens and finishes the same work. It does not count the return to a cold cache on the turn after a switch, or any retry a smaller model would need. Only a benchmark measures what routing saves.

## Routing runner

Codex's hooks cannot change a request's model, so routing runs in a separate runner. It starts `codex app-server` and speaks its protocol over stdio, choosing each turn's effort or model with `turn/start`:

```bash
node packages/cli/dist/cli.js codex                          # observe: records the choice, changes nothing
node packages/cli/dist/cli.js codex --mode route             # change effort on your model, turn by turn
node packages/cli/dist/cli.js codex --mode route --strategy model
node packages/cli/dist/cli.js codex --once "fix the typo in README.md"
```

- **Only the runner's turns are routed.** Turns typed in the Codex app or the VS Code panel are not, and installing anything does not change that.
- **Same rules as Claude Code.** Each prompt goes through `analyzeTask` and `route` for its tier (confidence, follow-ups, a failed verification). Model and effort are then chosen here.
- **Your setting and the thread's are kept apart.** `thread/start` reports your configured model and effort (the baseline). Codex keeps whatever a `turn/start` sets for every later turn, so the runner also tracks what the thread runs on now. Standard work returns to the baseline; light work never moves above it, and heavy work never below it, in model or in effort.
- **Observe first, effort before models.** The default mode only records. `--mode route` changes effort on your model; `--strategy model` also moves light work to Luna and heavy work to Astra.
- **Only what the account lists.** Models and efforts are limited to what `model/list` reports at start. A target the account lacks keeps the current model; an effort a model does not take falls to the highest one it does below it.
- **The cache guard covers effort too.** Past 50,000 tokens of context, a move to a smaller model or a lower effort is held; a move up never is. Unlike Claude Code's, Codex's cache did not survive an effort change. On Codex 0.164 the turn after one read 8,448 and then 0 tokens from the cache, where turns that kept their setting read 12,928 and 16,512. These are two observations, not a measured rate.
- **Escalation applies from the next turn.** `turn/steer` cannot change the model, so a failed verification raises a continuation's tier ("continue", "still failing") on the next turn. Retrying a failed turn on its own, with a limit on tries and time, is not built yet.
- **Approvals are asked in the terminal**: run, always for this session, or decline. With no terminal (piped input) they are declined. Ctrl+C stops the running turn; with none running, it leaves.

**Sign-in.** At start the runner reads `account/read` and says how turns are paid for: a ChatGPT sign-in draws on the plan's limits, and the runner shows how much of the 5-hour and weekly limits is used (`account/rateLimits/read`). An API-key sign-in is billed per token, and the runner says so.

**Usage.** Codex sends `thread/tokenUsage/updated` once per model request: `last` is that request's usage, `total` the thread's. On Codex 0.164 both matched the rollout file's `token_usage_record` lines exactly. A notification whose total did not grow repeats an earlier one and is skipped.

**Records.** Each request and turn is written in the plugin's record format (`product: "codex"`): the tier, your setting, the router's choice, what ran, whether it was applied, and the request's tokens. They go to `~/.agent-fusion-router/codex-logs` (`--log-dir`), apart from the Claude Code plugin's logs, so the Claude report never counts Codex requests. Codex's rollout files stay the source of the usage ledger above; the runner's turns appear there like any other.

**What is measured and what is not.** The runner records what each turn actually ran on and what it used. A cost at API list prices is still a conversion, not a bill, and "what it would have cost on your model" is still an estimate on the same tokens: a smaller model or effort can take more requests or fail. Only a comparison run measures what routing saves.

**Protocol.** `codex app-server` is marked experimental. The fields used here were checked against Codex 0.164 (`codex app-server generate-json-schema`) and exercised on Windows with a ChatGPT sign-in. The runner finds `codex` from `CODEX_BIN`, the PATH, or the VS Code extension's bundled binary (`--codex` to choose).
