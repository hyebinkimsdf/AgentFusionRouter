import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

import * as cart from '../../src/cart.js'

const root = new URL('../../', import.meta.url)

const sourceFiles = async dir => {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true, recursive: true })

  return entries
    .filter(e => e.isFile() && e.name.endsWith('.js') && !e.parentPath.includes('hidden'))
    .map(e => `${e.parentPath}/${e.name}`)
}

test('calculateTotal is exported and calcTotal is gone', () => {
  assert.equal(typeof cart.calculateTotal, 'function')
  assert.equal(cart.calcTotal, undefined)
})

test('no source or test file mentions calcTotal', async () => {
  const files = [...(await sourceFiles('src/')), ...(await sourceFiles('test/'))]

  for (const file of files) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /calcTotal/, file)
  }
})
