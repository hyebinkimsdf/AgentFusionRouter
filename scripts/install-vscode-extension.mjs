// Installs the built VS Code extension for this user, without a marketplace:
// copies its manifest, translations, README and bundle into VS Code's
// extensions folder. Reload VS Code afterwards.
//   npm run build && npm run vscode:install
//   npm run vscode:install -- --extensions-dir <dir>   another editor's folder (Insiders, Cursor, ...)

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SOURCE = 'packages/vscode'
const FILES = ['package.json', 'package.nls.json', 'package.nls.ko.json', 'README.md', 'dist/extension.cjs']

const flag = process.argv.indexOf('--extensions-dir')
const extensionsDir = flag === -1 ? join(homedir(), '.vscode', 'extensions') : process.argv[flag + 1]
if (!extensionsDir) throw new Error('--extensions-dir needs a folder')

const manifest = JSON.parse(await readFile(join(SOURCE, 'package.json'), 'utf8'))
if (!(await stat(join(SOURCE, 'dist/extension.cjs')).catch(() => undefined))) throw new Error('No bundle yet: run `npm run build` first.')

const target = join(extensionsDir, `${manifest.publisher}.${manifest.name}-${manifest.version}`)
await rm(target, { recursive: true, force: true })
for (const file of FILES) {
  await mkdir(join(target, file, '..'), { recursive: true })
  await cp(join(SOURCE, file), join(target, file))
}

console.log(`Installed ${manifest.publisher}.${manifest.name} ${manifest.version} in ${target}`)
console.log('Reload VS Code (Developer: Reload Window) to start it. Remove that folder to uninstall.')
