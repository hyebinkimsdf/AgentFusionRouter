/**
 * Commands whose exit status says whether the work is done: tests, builds,
 * type checks and linters. Matched anywhere in a compound command.
 */
const VERIFICATION_COMMAND =
  /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|type-check|check|verify)\b|npx\s+(?:tsc|jest|vitest|eslint|playwright\s+test)\b|(?:tsc|jest|vitest|mocha|pytest|phpunit|rspec|eslint|ruff|mypy|pyright)(?=[\s;&|)]|$)|go\s+(?:test|build|vet)\b|cargo\s+(?:test|build|check|clippy)\b|(?:mvn|\.\/mvnw|mvnw)\s+(?:test|verify|package)\b|(?:gradle|\.\/gradlew|gradlew)\s+(?:test|build|check)\b|make\s+(?:test|check)\b|dotnet\s+(?:test|build)\b|python3?\s+-m\s+(?:pytest|unittest|mypy)\b|node\s+--test\b|deno\s+(?:test|check|lint)\b)/

export const isVerificationCommand = (command: string): boolean =>
  VERIFICATION_COMMAND.test(` ${command}`)

export type EscalationPolicy = {
  /** Consecutive failed verifications that move the turn up a tier. */
  failuresBeforeEscalation: number
  /** The most tiers one turn may climb: a cap on spend, not on effort. */
  maxEscalationsPerTurn: number
}

export const DEFAULT_ESCALATION: EscalationPolicy = {
  failuresBeforeEscalation: 2,
  maxEscalationsPerTurn: 1,
}

export type VerificationState = {
  passes: number
  failures: number
  consecutiveFailures: number
  escalations: number
  last?: 'pass' | 'fail'
}

export const newVerificationState = (): VerificationState => ({
  passes: 0,
  failures: 0,
  consecutiveFailures: 0,
  escalations: 0,
})

/**
 * Records one verification result. `escalate` is true when this failure is
 * the one that crosses the threshold and the turn still has room to climb.
 */
export const recordVerification = (
  state: VerificationState,
  hasPassed: boolean,
  policy: EscalationPolicy = DEFAULT_ESCALATION,
): { state: VerificationState; escalate: boolean } => {
  if (hasPassed) {
    return {
      state: { ...state, passes: state.passes + 1, consecutiveFailures: 0, last: 'pass' },
      escalate: false,
    }
  }

  const consecutiveFailures = state.consecutiveFailures + 1
  const escalate =
    consecutiveFailures >= policy.failuresBeforeEscalation &&
    state.escalations < policy.maxEscalationsPerTurn

  return {
    state: {
      ...state,
      failures: state.failures + 1,
      consecutiveFailures: escalate ? 0 : consecutiveFailures,
      escalations: state.escalations + (escalate ? 1 : 0),
      last: 'fail',
    },
    escalate,
  }
}
