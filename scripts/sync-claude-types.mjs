// Copies Claude Code's plugin API declarations into packages/claude-adapter/.types
// so `tsc` can check the adapter. The file belongs to Claude Code and changes
// with each release, so it is copied, not committed.
//
// Where it comes from, first found wins:
//   1. the path in CLAUDE_CODE_TYPES
//   2. plugins/claude/agent-fusion-router/.claude-plugin/types/claude-code/index.d.ts,
//      which Claude Code writes when it loads the plugin with --plugin-dir

import { copyFile, mkdir, stat } from 'node:fs/promises'

const candidates = [
  process.env.CLAUDE_CODE_TYPES,
  'plugins/claude/agent-fusion-router/.claude-plugin/types/claude-code/index.d.ts',
].filter(Boolean)

const exists = path => stat(path).then(s => s.isFile(), () => false)

let source
for (const candidate of candidates) {
  if (await exists(candidate)) {
    source = candidate
    break
  }
}

if (source === undefined) {
  console.error(
    [
      'No Claude Code type declarations found. Either:',
      '  - start Claude Code once with `claude --plugin-dir plugins/claude/agent-fusion-router`, or',
      '  - set CLAUDE_CODE_TYPES to a claude-code.d.ts file.',
    ].join('\n'),
  )
  process.exit(1)
}

await mkdir('packages/claude-adapter/.types', { recursive: true })
await copyFile(source, 'packages/claude-adapter/.types/claude-code.d.ts')
console.log(`Copied ${source}`)
