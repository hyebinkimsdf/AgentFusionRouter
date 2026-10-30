/** The three routing tiers. Order matters: index is the tier's rank. */
export const TIERS = ['light', 'standard', 'heavy'] as const
export type Tier = (typeof TIERS)[number]

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Mode = 'observe' | 'route'

/** Which product an adapter is running inside. */
export type Product = 'claude-code' | 'codex'

export const tierRank = (tier: Tier): number => TIERS.indexOf(tier)

/** Moves `tier` up by `steps` (negative moves down), clamped to the ends. */
export const bumpTier = (tier: Tier, steps = 1): Tier => {
  const index = Math.min(TIERS.length - 1, Math.max(0, tierRank(tier) + steps))

  return TIERS[index] ?? tier
}
