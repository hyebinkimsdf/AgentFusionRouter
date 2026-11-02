import type { Effort, Tier } from './types.ts'

/** USD per million tokens. */
export type Price = {
  input: number
  output: number
  /** Cache reads. */
  cacheRead: number
  /** Cache writes at the 1-hour TTL (2x input), the one Claude Code writes. */
  cacheWrite: number
}

/** Claude families, then Codex's (OpenAI) families. Ranks compare within one product only. */
export type Family = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'luna' | 'terra' | 'sol' | 'astra'

export type ModelEntry = {
  id: string
  family: Family
  price: Price
  /** Some models charge more once the prompt passes a size. */
  longContext?: { aboveInputTokens: number; price: Price }
}

/**
 * Anthropic first-party list prices as of this date, checked row by row
 * against https://platform.claude.com/docs/en/about-claude/pricing. They are
 * estimates for the usage report, never a bill: Bedrock, Vertex and
 * subscription plans are priced differently.
 */
export const PRICES_AS_OF = '2026-10-30'

// Claude Code writes the prompt cache with the 1-hour TTL: its own usage report
// counts every write as `cacheCreationEphemeral1hInputTokens`, billed at 2x
// input. A 5-minute write would be 1.25x, and pricing at that rate read 25%
// low against Claude Code's total on a measured run.
const price = (input: number, output: number, cacheRead = input * 0.1): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 2,
})

/** Newest first within each family: alias lookup takes the first match. */
export const CLAUDE_MODELS: readonly ModelEntry[] = [
  { id: 'claude-fable-5-1', family: 'fable', price: price(10, 50, 0.25) },
  { id: 'claude-fable-5', family: 'fable', price: price(10, 50, 1) },
  { id: 'claude-opus-5-5', family: 'opus', price: price(4, 20, 0.2) },
  { id: 'claude-opus-5', family: 'opus', price: price(5, 25) },
  { id: 'claude-opus-4-8', family: 'opus', price: price(5, 25) },
  { id: 'claude-opus-4-7', family: 'opus', price: price(5, 25) },
  { id: 'claude-opus-4-6', family: 'opus', price: price(5, 25) },
  // Cache hits at 0.05x input, like Opus 5.5: $0.10, not the usual 0.1x.
  { id: 'claude-sonnet-5-5', family: 'sonnet', price: price(2, 10, 0.1) },
  { id: 'claude-sonnet-5', family: 'sonnet', price: price(2, 10) },
  { id: 'claude-sonnet-4-6', family: 'sonnet', price: price(3, 15) },
  {
    id: 'claude-haiku-5-5',
    family: 'haiku',
    price: price(0.1, 0.5),
    longContext: { aboveInputTokens: 100_000, price: price(0.5, 2.5) },
  },
  { id: 'claude-haiku-4-5', family: 'haiku', price: price(1, 5) },
]

/**
 * OpenAI API list prices (Standard tier) as of this date, checked row by row
 * against https://developers.openai.com/api/docs/pricing. They price Codex
 * usage at what the API would charge; on a ChatGPT plan Codex draws on plan
 * limits and credits instead, so these are never what was paid.
 */
export const CODEX_PRICES_AS_OF = '2026-11-02'

// Cache writes at the 30-minute rate. Codex reports `cache_write_input_tokens`
// but every session read so far wrote none, so the TTL it would use is
// unconfirmed. Long context (more than 272K input tokens) is priced for the
// whole request, as the table lists it.
const openai = (input: number, output: number, cacheRead: number, cacheWrite: number): Price => ({ input, output, cacheRead, cacheWrite })
const LONG_OPENAI = 272_000

/** Codex's models, newest first within each family: alias lookup takes the first match. */
export const CODEX_MODELS: readonly ModelEntry[] = [
  { id: 'gpt-6-astra', family: 'astra', price: openai(10, 50, 1, 12.5), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(20, 75, 2, 25) } },
  { id: 'gpt-6.1-sol', family: 'sol', price: openai(2, 10, 0.1, 2.5), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(4, 15, 0.2, 5) } },
  { id: 'gpt-6-sol', family: 'sol', price: openai(2, 10, 0.2, 2.5), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(4, 15, 0.4, 5) } },
  { id: 'gpt-5.6-sol', family: 'sol', price: openai(4, 20, 0.4, 5), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(8, 30, 0.8, 10) } },
  { id: 'gpt-6.1-terra', family: 'terra', price: openai(1, 5, 0.05, 1.25), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(2, 7.5, 0.1, 2.5) } },
  { id: 'gpt-5.6-terra', family: 'terra', price: openai(2, 12, 0.2, 2.5), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(4, 18, 0.4, 5) } },
  { id: 'gpt-6-luna', family: 'luna', price: openai(0.1, 0.5, 0.01, 0.125), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(0.2, 0.75, 0.02, 0.25) } },
  { id: 'gpt-5.6-luna', family: 'luna', price: openai(0.2, 1.2, 0.02, 0.25), longContext: { aboveInputTokens: LONG_OPENAI, price: openai(0.4, 1.8, 0.04, 0.5) } },
]

// Codex's order follows OpenAI's model guide: Luna for focused, high-volume
// work, Terra for fast everyday work, Sol near Astra at a lower cost, Astra
// the most capable.
const FAMILY_RANK: Record<Family, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3, luna: 0, terra: 1, sol: 2, astra: 3 }

/**
 * Finds a model by full id (dated or suffixed ids such as `-20260101` or
 * `[1m]` match their base id) or by family alias (`opus` is the newest Opus).
 * `models` defaults to this release's catalog; a benchmark passes the one it
 * was run with, so its costs recompute the same after prices change.
 */
export const findModel = (idOrAlias: string, models: readonly ModelEntry[] = CLAUDE_MODELS): ModelEntry | undefined => {
  const name = idOrAlias.toLowerCase().trim()

  return (
    models.find(m => m.id === name) ??
    [...models].sort((a, b) => b.id.length - a.id.length).find(m => name.startsWith(m.id)) ??
    models.find(m => m.family === name)
  )
}

/** The family a model id or alias belongs to, by name, even if unlisted. */
export const familyOf = (idOrAlias: string): Family | undefined => {
  const listed = (findModel(idOrAlias) ?? findModel(idOrAlias, CODEX_MODELS))?.family
  if (listed) return listed

  const name = idOrAlias.toLowerCase()
  const parts = name.split(/[^a-z0-9.]+/)

  // Claude's family names are long enough to find anywhere in an id. Codex's
  // are short words (`sol` is in `console`), so only a whole part of the id
  // names one: an unknown model must stay unknown, never be switched away from.
  return CLAUDE_FAMILIES.find(f => name.includes(f)) ?? CODEX_FAMILIES.find(f => parts.includes(f))
}

const CLAUDE_FAMILIES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const CODEX_FAMILIES: readonly Family[] = ['luna', 'terra', 'sol', 'astra']

/** Higher is more capable. Unknown models rank undefined, never guessed. */
export const capabilityRank = (idOrAlias: string): number | undefined => {
  const family = familyOf(idOrAlias)

  return family === undefined ? undefined : FAMILY_RANK[family]
}

/** What each tier asks for. An absent model or effort leaves the session's. */
export type TierTarget = { model?: string; effort?: Effort }

/**
 * Claude Code defaults. Aliases, not ids, so a new release is picked up
 * without a code change. Standard keeps whatever the person chose.
 */
export const CLAUDE_TIER_DEFAULTS: Readonly<Record<Tier, TierTarget>> = {
  light: { model: 'haiku', effort: 'low' },
  standard: {},
  heavy: { model: 'opus', effort: 'high' },
}

/**
 * Codex defaults, from OpenAI's model guide: Luna for focused work, Astra for
 * the hardest. Terra is for writing, visual work and computer use, not a
 * coding tier, until a benchmark says otherwise.
 */
export const CODEX_TIER_DEFAULTS: Readonly<Record<Tier, TierTarget>> = {
  light: { model: 'luna', effort: 'low' },
  standard: {},
  heavy: { model: 'astra', effort: 'high' },
}
