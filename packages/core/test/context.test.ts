import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { TaskBrief } from '../src/context.ts'
import { briefProblems, readyTasks, renderBrief, writeConflicts } from '../src/context.ts'

const brief = (id: string, over: Partial<TaskBrief> = {}): TaskBrief => ({
  id,
  goal: `do ${id}`,
  inputs: [],
  writable: [`src/${id}.ts`],
  dependsOn: [],
  done: ['npm test'],
  ...over,
})

describe('briefProblems', () => {
  test('a complete brief has none', () => {
    assert.deepEqual(briefProblems(brief('a')), [])
  })

  test('names each missing part', () => {
    assert.equal(briefProblems(brief('a', { goal: ' ', writable: [], done: [] })).length, 3)
  })
})

describe('writeConflicts', () => {
  test('independent tasks writing one file conflict', () => {
    const conflicts = writeConflicts([brief('a', { writable: ['src/x.ts'] }), brief('b', { writable: ['src/x.ts'] })])

    assert.deepEqual(conflicts, [{ path: 'src/x.ts', tasks: ['a', 'b'] }])
  })

  test('a folder scope covers the files in it', () => {
    const conflicts = writeConflicts([brief('a', { writable: ['src/'] }), brief('b', { writable: ['src/x.ts'] })])

    assert.equal(conflicts[0]?.path, 'src/x.ts')
  })

  test('ordered tasks never conflict, even through another task', () => {
    const briefs = [
      brief('a', { writable: ['src/x.ts'] }),
      brief('b', { dependsOn: ['a'] }),
      brief('c', { writable: ['src/x.ts'], dependsOn: ['b'] }),
    ]

    assert.deepEqual(writeConflicts(briefs), [])
  })
})

describe('readyTasks', () => {
  test('returns tasks whose dependencies are finished', () => {
    const briefs = [brief('a'), brief('b', { dependsOn: ['a'] })]

    assert.deepEqual(readyTasks(briefs, new Set()).map(b => b.id), ['a'])
    assert.deepEqual(readyTasks(briefs, new Set(['a'])).map(b => b.id), ['b'])
  })
})

test('renderBrief lists every section', () => {
  const text = renderBrief(brief('a', { inputs: ['docs/spec.md'] }))

  for (const heading of ['## Goal', '## Read first', '## You may change only', '## Done when']) {
    assert.ok(text.includes(heading), heading)
  }
})
