# Codex adapter

Two parts. The usage ledger is implemented. The routing runner is planned.

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
- **Which prompt is read.** The prompt is the turn's first `user_message`, or the first user `response_item` when there is none (seen on Codex 0.164 and 0.165). Context blocks Codex injects (`<environment_context>`) are left out, and so is the IDE context the VS Code extension puts before `## My request:`.
- **What is kept.** The prompt is read in memory, and only the router's analysis (tier, kind, confidence, signal names) is kept.

**Potential savings** is actual minus simulated, at API list prices. It is a simulation, not a saving that happened. It assumes a smaller model uses the same tokens and finishes the same work. It does not count the return to a cold cache on the turn after a switch, or any retry a smaller model would need. Only a benchmark measures what routing saves.

## Routing runner (planned)

Codex's hooks cannot change the model of a request, so routing inside the Codex app needs either a separate runner or a model-provider gateway. The runner design, as a local runner and not a plugin that intercepts the Codex app:

```
agent-fusion-router codex "<task>"
  └─ starts `codex app-server` and speaks its protocol over stdio
       └─ turn/start with the model and reasoning effort that route() chose
```

- Turns started through the runner are routed with the same `analyzeTask`, `route`, and `recordVerification` as Claude Code, using a Codex model catalog and tier targets.
- Turns started in the Codex app itself are **not** routed. The project should never claim that installing a plugin reroutes the app's own requests.
- A model is chosen per turn, so an escalation applies from the next turn, not within one.

An optional Codex plugin could add tools or skills that hand work to the runner. It is distributed through this repository's own marketplace, since the public directory's rules on hooks and local servers may not admit it (see [docs/publishing.md](../../docs/publishing.md)).

### Before building

- Confirm the current app-server protocol from the Codex documentation (`codex app-server generate-json-schema` for the installed version). Check which fields `turn/start` takes for model and effort, and how usage is reported back.
- Add a Codex model catalog next to `CLAUDE_MODELS`, with prices and families, and keep model names out of router logic.
- Measure first: decide on routing from the ledger's potential savings and a `codex exec` benchmark, not from estimates alone.
- Port the five plugin integration tests to the runner.
