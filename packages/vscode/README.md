# Agent Fusion Router: savings

A VS Code status bar entry with Agent Fusion Router's savings figures for Claude Code and Codex, for today, the last 7 days or the last 30 days. Click it for the full report. Its menus and texts follow VS Code's language, in Korean or English.

```
$(graph-line) Claude 절감 추정 $0.42 · Codex 잠재 $0.31
```

## What the figures are

Every amount is at API list prices. None is a bill, and none is a measured saving. Only a benchmark measures what routing saves.

| Shown | What it is |
|---|---|
| **Claude saved (est.)** (*Claude 절감 추정*) | The plugin routed requests in this period. This is those requests priced at the models they were asked for, less what they cost, on the same tokens. |
| **Claude potential** (*Claude 잠재*) | The plugin ran in observe mode. This is what its choices would have saved on the same tokens: a simulation. |
| **Codex potential** (*Codex 잠재*) | Codex itself is never routed. This is what this router would have saved choosing each turn's model: a simulation (see [the Codex adapter](../codex-adapter/README.md)). |

On a ChatGPT plan, Codex draws on plan limits and credits, not these amounts. The hover says which basis each figure has. Under the router's default policy, ordinary work keeps the turn's model, so a session run on the most capable model can show $0.00. Set `agentFusionRouter.codexStandardModel` to `sol` to simulate ordinary work on Sol.

## What it reads

It reads two sources and nothing else:

- **The Claude Code plugin's logs:** `~/.agent-fusion-router/logs`, or `agentFusionRouter.claudeLogDir`.
- **Codex's session records:** `CODEX_HOME`, else `~/.codex`, or `agentFusionRouter.codexHome`.

It writes nothing, keeps nothing on disk, and sends nothing anywhere.

**Codex prompts.** Prompts in Codex's records are classified in memory, and only the analysis is kept, as the CLI does (see [data handling](../../docs/data-handling.md)).

**Refreshing.** It re-reads every `agentFusionRouter.refreshMinutes` minutes (default 5), and on *Agent Fusion Router: Refresh savings*. A file is read again only when it changed. A file last written before the period starts is not opened.

**WSL.** An agent in WSL writes inside the distribution. Point the settings at it, for example `\\wsl$\Ubuntu\home\<user>\.codex`.

## Installing

It is not on the marketplace. From the repository root:

```bash
npm ci
npm run build
npm run vscode:install          # copies it into ~/.vscode/extensions
```

Then reload VS Code (*Developer: Reload Window*). To uninstall, remove `~/.vscode/extensions/hyebinkimsdf.agent-fusion-router-vscode-0.1.0`. `--extensions-dir <dir>` installs into another editor's folder.

## Settings

| Setting | Default | |
|---|---|---|
| `agentFusionRouter.period` | `today` | `today` (since local midnight), `7d` or `30d` |
| `agentFusionRouter.refreshMinutes` | `5` | How often to re-read |
| `agentFusionRouter.claudeLogDir` | empty | The plugin's log folder |
| `agentFusionRouter.codexHome` | empty | Codex's data folder |
| `agentFusionRouter.codexStandardModel` | empty | Simulate ordinary Codex work on this model (`sol`, `terra`, an id) |
