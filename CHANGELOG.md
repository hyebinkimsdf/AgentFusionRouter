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
