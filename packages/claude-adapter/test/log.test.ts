import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { UsageRecord } from '@agent-fusion-router/core'

import { createLog, type FileWrite, parseRecords } from '../src/log.ts'

const step = (ts: number): UsageRecord =>
  ({
    v: 1,
    kind: 'step',
    ts,
    product: 'claude-code',
    session: 's1',
    turn: 't1',
    step: 0,
    mode: 'route',
    applied: false,
    requestedModel: 'claude-opus-5-5',
  }) as UsageRecord

describe('createLog', () => {
  test('a record on a later UTC date starts a new file instead of repeating the old one', async () => {
    const log = createLog()
    log.setDir('/logs')

    log.add(step(new Date('2026-10-30T23:59:00Z').getTime()))
    log.add(step(new Date('2026-10-31T00:01:00Z').getTime()))

    const written: FileWrite[] = []
    await log.flush(async file => {
      written.push(file)
    })

    assert.equal(written.length, 2, 'one file per date')
    const records = parseRecords(written.map(f => f.text))
    assert.equal(records.length, 2, 'each record is written exactly once, not duplicated into the next day\'s file')
  })

  test('records within the same date accumulate in one file', async () => {
    const log = createLog()
    log.setDir('/logs')

    log.add(step(new Date('2026-10-30T10:00:00Z').getTime()))
    log.add(step(new Date('2026-10-30T11:00:00Z').getTime()))

    const written: FileWrite[] = []
    await log.flush(async file => {
      written.push(file)
    })

    assert.equal(written.length, 1)
    assert.equal(parseRecords(written.map(f => f.text)).length, 2)
  })
})
