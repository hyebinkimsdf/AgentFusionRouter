import type { Tier, Tokens } from '@agent-fusion-router/core'

export type Task = {
  id: string
  /** What kind of work it is, for grouping results. */
  kind: string
  /** The tier a person would pick: the router's decision is scored against it. */
  expectedTier: Tier
  prompt: string
  /** Strings the agent's final answer must contain, for questions with no code change. */
  answerIncludes?: string[]
}

export type TaskSet = {
  name: string
  description?: string
  /** The project folder, relative to the task file. Each run gets a fresh copy. */
  project: string
  tasks: Task[]
}

export type Arm = {
  id: string
  label: string
  /** The session model, as `claude --model` takes it (`opus`, `opusplan`); absent, the account's default. */
  model?: string
  /** The plugin's settings for this arm. */
  plugin: Record<string, string | number | boolean>
}

/** What the runner measured itself, beside the raw files. */
export type RunMeta = {
  taskId: string
  armId: string
  rep: number
  simulated: boolean
  startedAt: string
  wallMs: number
  exitCode: number | null
  timedOut: boolean
}

/** The independent check, run by the runner after the agent finished. */
export type CheckOutcome = {
  testsPassed: boolean
  testsExitCode: number | null
  answerOk?: boolean
}

export type ClaudeFacts = {
  isError: boolean
  costUsd?: number
  durationMs?: number
  numTurns?: number
  permissionDenials: number
  /** Every request of the session, by `modelUsage`: the conversation and Claude Code's own side requests (titles, summaries). */
  tokens: Tokens
  /** The conversation's requests alone, by the top-level `usage`: what the plugin can see. */
  conversationTokens?: Tokens
  byModel: Record<string, { tokens: Tokens; costUsd?: number }>
}

export type PluginFacts = {
  /** False when the plugin wrote no step records: routing did not happen. */
  loaded: boolean
  requests: number
  tokens: Tokens
  costUsd: number
  /** The tier the router chose for the first main-loop request. */
  decidedTier?: Tier
  routedRequests: number
  escalations: number
  models: string[]
}

export type RunResult = {
  taskId: string
  armId: string
  rep: number
  valid: boolean
  invalidReason?: string
  success: boolean
  check: CheckOutcome
  wallMs: number
  /** Claude Code's own report of the session (`claude -p --output-format json`). */
  claude?: ClaudeFacts
  /** What the plugin recorded for the same session. */
  plugin: PluginFacts
  diff: { files: number; added: number; removed: number }
}
