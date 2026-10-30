# Publishing

## 1. Self-hosted marketplace (no review)

This repository is already a Claude Code marketplace: `.claude-plugin/marketplace.json` lists the plugin at `plugins/claude/agent-fusion-router`. Once the repository is public on GitHub, anyone can install it:

```
/plugin install agent-fusion-router --marketplace hyebinkimsdf/agentfusionrouter
```

To release a new version:

1. Change code, run `npm run check`, and commit the rebuilt `hooks/register.js`.
2. Bump `version` in `plugins/claude/agent-fusion-router/.claude-plugin/plugin.json`.
3. Add an entry to `CHANGELOG.md`, then tag the release (`v0.2.0`).

Users receive the new version according to their marketplace update settings.

## 2. Anthropic's plugin directory

Submission goes through the developer portal at https://claude.ai/directory/manage, which connects the GitHub repository, then validates and reviews it. The repository must be public before the listing goes live. This directory is a separate path from the `claude-plugins-official` marketplace.

Before submitting:

```bash
claude plugin validate plugins/claude/agent-fusion-router --profile directory
```

At the time of writing, that check needs:

- a README, which the repository root README satisfies;
- an icon: a square PNG, 512–2048 px, at `plugins/claude/agent-fusion-router/.claude-plugin/icon.png`. **Not yet added.** The first icon saved in the portal stays as the listing icon, so finalize it before the first submission.

The directory has its own rules for plugins with a hooks module, and the local validator does not apply them. Expect the portal's review to check the hooks module itself.

## 3. Codex

Codex's public plugin directory had restrictions relevant to this project when it was planned: packages with lifecycle hooks were not accepted, and local MCP servers were limited to approved partners. Recheck the current rules at https://developers.openai.com/plugins/deploy/submission before building toward them. The Codex runner is designed to work without the directory: distributed through GitHub Releases or npm, with an optional helper plugin from this repository's own marketplace.
