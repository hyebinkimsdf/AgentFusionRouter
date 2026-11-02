# Compatibility

| Component | Supported | Tested with |
|---|---|---|
| Claude Code plugin | Claude Code with function-hook plugins (mods): `turn.step`, `agent.spawn`, `turn.start`, `turn.complete`, `tool.call` | 2.1.312 on Windows 10 (`claude plugin validate`, `claude plugin test`) |
| CLI | Node 20 or newer | Node 24 |
| Development | Node 22.18 or newer (tests run TypeScript directly) | Node 24, TypeScript 7.0, esbuild 0.28 |
| Codex usage ledger | Session records with `token_usage_record` and `token_count` lines; older records with running totals only | Codex 0.159, 0.164 and 0.165 (VS Code extension and desktop app) on Windows 10 |
| Codex routing runner | `codex app-server`: `thread/start`, `turn/start` with `model` and `effort`, `model/list`, `account/read`, `thread/tokenUsage/updated` | Codex 0.164 (bundled with the VS Code extension) on Windows 10, ChatGPT sign-in. The protocol is marked experimental |
| VS Code status bar | VS Code 1.90 or newer | VS Code with Claude Code 2.1.314 installed, on Windows 10 (bundle loaded against a stand-in for the VS Code API; not yet run in the editor) |

The plugin API is early access and may change between Claude Code releases. After a Claude Code update, check the plugin:

```bash
npm run typecheck:claude
claude plugin validate plugins/claude/agent-fusion-router
claude plugin test plugins/claude/agent-fusion-router
```

## Models

Tier targets are aliases: `haiku` for light, `opus` for heavy, and the session's own model for standard. Each alias resolves to the newest model of its family. The router compares capability by family (Haiku < Sonnet < Opus < Fable). It never switches away from a model it cannot place, such as a custom id behind a gateway.

Cost estimates use the prices in `packages/core/src/catalog.ts` (as of 2026-10-06, Anthropic first-party list prices). Amazon Bedrock, Google Vertex AI, and subscription plans are priced differently. Models the catalog lacks show `n/a` in the report and are left out of the totals.
