# Data handling

## What is recorded

The Claude Code plugin writes JSON Lines under `~/.agent-fusion-router/logs/`, or the folder set in **Log folder**. Each session writes its own files, named `<date>_<session id>_<load id>-<n>.jsonl`.

| Record | Fields |
|---|---|
| `step` (one model request) | time, session id, turn id, step index, subagent id, mode, tier, model requested before routing, model and effort the router chose, whether it was applied, model that answered, token counts (input, output, cache read, cache write), stop reason, reason tags |
| `turn` | time, session id, turn id, subagent id, tier, task kind, signal names, outcome (`answer`, `aborted`, `refusal`, `error`), duration, verification passes and failures, escalations |
| `spawn` (one subagent start) | time, session id, subagent id and type, tier, model requested, model chosen, model it runs on, reason tags |

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

## Deleting data

Delete `~/.agent-fusion-router/`. Uninstalling the plugin does not delete it.
