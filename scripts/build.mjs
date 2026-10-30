// Bundles the Claude Code hooks module and the CLI.
//   node scripts/build.mjs           build both
//   node scripts/build.mjs --check   fail if the committed plugin bundle is stale (CI)
//
// The plugin bundle is committed: installing from the marketplace must not
// need a build. Core is bundled into it because a hooks module can import
// only files inside its own plugin folder.

import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const PLUGIN_OUT = 'plugins/claude/agent-fusion-router/hooks/register.js'
const isCheck = process.argv.includes('--check')

const plugin = await build({
  entryPoints: ['packages/claude-adapter/src/register.ts'],
  bundle: true,
  format: 'esm',
  // The plugin sandbox has no Node: a Node import fails the build here.
  platform: 'neutral',
  target: 'es2023',
  external: ['claude-code'],
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: '// Generated from packages/claude-adapter by scripts/build.mjs. Edit the source and run `npm run build`.' },
  outfile: PLUGIN_OUT,
  write: !isCheck,
})

if (isCheck) {
  const built = new TextDecoder().decode(plugin.outputFiles[0].contents)
  const committed = await readFile(PLUGIN_OUT, 'utf8').catch(() => '')

  if (built !== committed) {
    console.error(`${PLUGIN_OUT} is out of date. Run \`npm run build\` and commit the result.`)
    process.exit(1)
  }
  console.log(`${PLUGIN_OUT} is up to date.`)
} else {
  await build({
    entryPoints: ['packages/cli/src/cli.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    charset: 'utf8',
    banner: { js: '#!/usr/bin/env node' },
    outfile: 'packages/cli/dist/cli.js',
  })
  console.log(`Built ${PLUGIN_OUT} and packages/cli/dist/cli.js`)
}
