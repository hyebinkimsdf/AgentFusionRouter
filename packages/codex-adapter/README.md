# Codex adapter (planned)

Not implemented. This note records the design, so the Codex work starts from the same engine once the Claude Code plugin has shown it pays off.

## Shape

A local runner, not a plugin that intercepts the Codex app:

```
agent-fusion-router codex "<task>"
  └─ starts `codex app-server` and speaks its protocol over stdio
       └─ turn/start with the model and reasoning effort that route() chose
```

- Turns started through the runner are routed with the same `analyzeTask`, `route`, and `recordVerification` as Claude Code, using a Codex model catalog and tier targets.
- Turns started in the Codex app itself are **not** routed. The project should never claim that installing a plugin reroutes the app's own requests.
- Usage is recorded in the same JSON Lines format with `product: "codex"`, so one report covers both.

An optional Codex plugin could add tools or skills that hand work to the runner. It is distributed through this repository's own marketplace, since the public directory's rules on hooks and local servers may not admit it (see [docs/publishing.md](../../docs/publishing.md)).

## Before building

- Confirm the current app-server protocol from the Codex documentation. Check which fields `turn/start` takes for model and effort, and how usage is reported back.
- Add a Codex model catalog next to `CLAUDE_MODELS`, with prices and families, and keep model names out of router logic.
- Port the five plugin integration tests to the runner.
