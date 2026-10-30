# Agent Fusion Router for Claude Code

Agent Fusion Router sends each turn to the model it needs. Clear, small tasks such as lookups, renames, and typos go to a light model. Ordinary work stays on your model. When tests or builds fail twice in a turn, the rest of the turn moves up a tier. Token usage and estimated cost are recorded locally and never include your prompts or code.

Install at the Claude Code prompt:

```
/plugin install agent-fusion-router --marketplace hyebinkimsdf/agentfusionrouter
```

The plugin starts in **observe mode**: it shows and records what it would do and changes nothing. Set **Mode** to `route` in `/config` to apply it.

- `/router` shows this session's routing and usage.
- `/router explain <task>` shows how a task would be routed.
- The repository's CLI (`agent-fusion-router report`) summarizes all recorded sessions.

Full documentation, settings, and privacy details: see the repository README.
