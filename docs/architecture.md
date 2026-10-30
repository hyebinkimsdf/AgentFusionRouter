# Architecture

One routing engine, one adapter per product. The engine never names a product's models in its logic: each adapter supplies its own catalog and tier targets.

```
packages/core            pure TypeScript, no Node or DOM APIs
  types.ts               tiers, effort, mode
  catalog.ts             models, families, list prices, tier defaults
  analyzer.ts            prompt → kind, suggested tier, confidence, signals
  router.ts              analysis + context → tier, model, effort (main loop and subagents)
  escalation.ts          which commands verify work; when failures escalate
  context.ts             task briefs for splitting work (phase 4)
  usage.ts               record types, cost estimates, report
packages/claude-adapter  maps Claude Code events onto core; writes logs
packages/cli             reads logs; report, explain, doctor
```

## The six components

| Component | Where | Notes |
|---|---|---|
| Model catalog | `core/catalog.ts` | Aliases (`haiku`, `opus`) in tier targets, so a new release needs no code change. Prices are used only for estimates. |
| Task analyzer | `core/analyzer.ts` | Weighted rules in English and Korean. Length is never a signal. Every rule has cases in `core/test/analyzer.test.ts`; add a case before changing a rule. |
| Router | `core/router.ts` | Rules only for now. An ambiguous result falls back to standard, which keeps the session's model. |
| Context manager | `core/context.ts` | A brief has five parts: goal, inputs, writable scope, dependencies, done checks. `writeConflicts` finds tasks that could edit the same path at once. Not wired into the adapter yet. |
| Verification and escalation | `core/escalation.ts` | Counts consecutive failed test, build, and lint commands. Escalation is capped per turn. |
| Usage logger | `claude-adapter/log.ts`, `core/usage.ts` | Real token counts as the API reports them, kept apart from estimated dollars. |

## Decision flow in Claude Code

| Event | What the adapter does |
|---|---|
| `turn.start` | Analyzes the prompt, then drops the text. |
| `turn.step`, first request of a main-loop turn | Calls `route()` with the analysis, the previous turn's tier, whether the last verification failed, and the context size of the last request. In `route` mode, rewrites `model` and `effort` on the way down. |
| `turn.step`, later requests | Reuses the turn's decision. Re-decides only after an escalation. |
| `tool.call` (Bash, PowerShell) | After the tool runs, a verification command (`npm test`, `pytest`, `cargo build`, …) counts as a pass or a fail. |
| `turn.complete` | Carries the tier and the last verification result into the next turn. Writes the turn record. |
| `agent.spawn` | `routeSpawn()`: only a confident light task moves down. An explicit `model`, a resumed run, a workflow agent, or a fork is left alone. |

Subagent steps are not rerouted after they start. Their model is chosen at spawn, and their usage is recorded like any other step.

### Why decisions stick to a turn

Prompt caches are per model. Switching models mid-conversation sends the whole context to a cold cache on the new model, written at 1.25× the input price. The router therefore:

1. decides once per turn, and again only after an escalation;
2. never switches down when the last request's context exceeds `cacheGuardTokens`; it lowers effort on the current model instead;
3. offers `strategy: effort`, which never switches models. In Claude Code, effort changes per message, which keeps the cache.

## Constraints of the Claude Code plugin API

These shape `claude-adapter` and are checked by `claude plugin validate`:

- The hooks module runs in a sandbox with no Node and no DOM. Core must stay free of Node APIs; `packages/core/tsconfig.json` has no Node types, so a Node import fails the typecheck.
- A module may import only files inside its own plugin folder. `scripts/build.mjs` bundles core into one file, and that file is committed so installing needs no build.
- `register` must be a function declared at the top of the bundled file.
- Engine calls must be spelled `$.noun.method(...)` inside a hook's own body. `$` is never passed to a helper. Helpers in the adapter are pure, and the logger returns what to write while the hook writes it.
- No dynamic `import()`.

## Codex

See [packages/codex-adapter](../packages/codex-adapter/README.md). Codex's app-server takes a model and effort per turn, so a local runner can apply the same `route()` decisions. A plugin inside the stock Codex app cannot reroute that app's own requests, and the project does not claim it can.
