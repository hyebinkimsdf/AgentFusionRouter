import type { Effort, Tier } from './types.ts'

/** USD per million tokens. */
export type Price = {
  input: number
  output: number
  /** Cache reads. */
  cacheRead: number
  /** Cache writes at the 5-minute TTL (1.25x input). 1-hour writes cost more. */
  cacheWrite: number
}

export type Family = 'haiku' | 'sonnet' | 'opus' | 'fable'

export type ModelEntry = {
  id: string
  family: Family
  price: Price
  /** Some models charge more once the prompt passes a size. */
  longContext?: { aboveInputTokens: number; price: Price }
}

/**
 * Anthropic first-party list prices as of this date. They are estimates for
 * the usage report, never a bill: Bedrock, Vertex and subscription plans are
 * priced differently. Update from https://claude.com/pricing.
 */
export const PRICES_AS_OF = '2026-10-06'

const price = (input: number, output: number, cacheRead = input * 0.1): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
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
  { id: 'claude-sonnet-5-5', family: 'sonnet', price: price(2, 10, 0.2) },
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

const FAMILY_RANK: Record<Family, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 }

const BY_ID_LENGTH = [...CLAUDE_MODELS].sort((a, b) => b.id.length - a.id.length)

/**
 * Finds a model by full id (dated or suffixed ids such as `-20260101` or
 * `[1m]` match their base id) or by family alias (`opus` is the newest Opus).
 */
export const findModel = (idOrAlias: string): ModelEntry | undefined => {
  const name = idOrAlias.toLowerCase().trim()

  return (
    CLAUDE_MODELS.find(m => m.id === name) ??
    BY_ID_LENGTH.find(m => name.startsWith(m.id)) ??
    CLAUDE_MODELS.find(m => m.family === name)
  )
}

/** The family a model id or alias belongs to, by name, even if unlisted. */
export const familyOf = (idOrAlias: string): Family | undefined => {
  const listed = findModel(idOrAlias)?.family
  if (listed) return listed

  const name = idOrAlias.toLowerCase()

  return (Object.keys(FAMILY_RANK) as Family[]).find(f => name.includes(f))
}

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
