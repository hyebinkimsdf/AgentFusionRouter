# Data handling

## What is recorded

The Claude Code plugin writes JSON Lines under `~/.agent-fusion-router/logs/`, or the folder set in **Log folder**. Each session writes its own files, named `<date>_<session id>_<load id>-<n>.jsonl`.

| Record | Fields |
|---|---|
| `step` (one model request) | time, session id, turn id, step index, subagent id, mode, tier, model requested before routing, model and effort the router chose, whether it was applied, effort before routing and as sent, model that answered, token counts (input, output, cache read, cache write), stop reason, reason tags |
| `turn` | time, session id, turn id, subagent id, tier, task kind, signal names, outcome (`answer`, `aborted`, `refusal`, `error`), duration, verification passes and failures, escalations |
| `spawn` (one subagent start) | time, session id, subagent id and type, tier, model requested, model chosen, model it runs on, reason tags |
| `cost` (Claude Code's own cost grew) | time, session id, the session's cost so far as Claude Code computes it, and the growth since the previous `cost` record |

## What is never recorded

- Prompt text. The analyzer reads it in memory at the start of a turn and drops it.
- Code, file contents, file paths, tool inputs and outputs, commands. A command is only matched against the verification pattern, and only pass or fail is counted.
- Model responses.

Signal names come from a fixed list (`lookup`, `mechanical`, `implement`, `debug`, `design`, `risk`, `scope:wide`, `files:3`, …). None of them contain text from the prompt.

## What leaves the machine

Nothing. The plugin makes no network requests. Model requests go to the provider your Claude Code session already uses, as they would without the plugin. The router changes only the `model` and `effort` fields of those requests.

## What the plugin can access

`claude plugin validate` lists every engine call the plugin makes:

- `$.fs.write`, `$.fs.list`, `$.fs.read`: the log folder only
- `$.env.get`: `HOME` and `USERPROFILE`, to find the home folder
- `$.session.id`, `$.session.model`: to name log files and explain decisions
- `$.ui.status`: the status line
- `$.command.register`: the `/router` command

It reads no other files and runs no commands.

## Codex session records

`agent-fusion-router codex-usage`, and `report` unless given `--no-codex`, read Codex's own session records (`rollout-*.jsonl` under `sessions/` and `archived_sessions/` in `CODEX_HOME`, else `~/.codex`). Those files hold your prompts, Codex's answers and tool output, and the commands read them whole.

- **What it keeps:** token counts, request and turn ids, model names, reasoning effort and timestamps.
- **Prompts:** each turn's prompt is read in memory so the router can classify it. Only the analysis is kept (tier, kind, confidence, signal names), never the text.
- **What it never keeps or prints:** message text, answers and tool output.
- **Paths:** files are named relative to Codex's home.
- **Writes and network:** it writes nothing, keeps no copy, and sends nothing anywhere.

## Codex routing runner

`agent-fusion-router codex` sends your prompts to Codex through `codex app-server`, as the Codex app does, with your Codex sign-in. It reads `account/read` to say how turns are paid for (never printing the account's email) and `account/rateLimits/read` for how much of the plan's limits is used.

It writes one record per request and per turn to `~/.agent-fusion-router/codex-logs` (`--log-dir`), in the plugin's format: thread and turn ids, tier, task kind and signal names, your model and effort, the router's choice, what ran, whether it was applied, the request's token counts, the turn's outcome, duration and verification counts. Prompts, answers and command output are not written. Codex itself keeps its own rollout file for the thread, as it does for every session.

The VS Code extension ([packages/vscode](../packages/vscode/README.md)) reads the plugin's logs and the same Codex records, the same way, inside the editor. It keeps its parse in memory while the editor runs, writes nothing and sends nothing.

## Deleting data

Delete `~/.agent-fusion-router/`. Uninstalling the plugin does not delete it.
