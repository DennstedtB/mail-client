import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MailCache, toSearchQuery, type CachedBody, type CachedEnvelope } from './mail-cache'

function envelope(uid: number, overrides: Partial<CachedEnvelope> = {}): CachedEnvelope {
  return {
    uid,
    subject: `Message ${uid}`,
    from: { name: 'Bob Test', email: 'bob@mailclient.test' },
    to: [{ email: 'alice@mailclient.test' }],
    cc: [],
    date: new Date(Date.UTC(2026, 10, uid)).toISOString(),
    seen: false,
    flagged: false,
    answered: false,
    hasAttachments: false,
    size: 1000,
    ...overrides,
  }
}

const body: CachedBody = {
  text: 'Die Quartalszahlen für Projekt Ölpreis sind da.',
  html: '<p>Die Quartalszahlen</p>',
  attachments: [{ id: '0', filename: 'q3.pdf', mimeType: 'application/pdf', size: 10 }],
  headers: { messageId: '<x@y>', references: [] },
  preview: 'Die Quartalszahlen für Projekt Ölpreis sind da.',
  to: [],
  cc: [],
}

let cache: MailCache
beforeEach(() => {
  cache = new MailCache(':memory:')
})
afterEach(() => cache.close())

describe('MailCache', () => {
  it('lists messages of a folder newest first', () => {
    cache.upsertMessages('a', 'INBOX', [envelope(1), envelope(3), envelope(2)])
    cache.upsertMessages('a', 'Sent', [envelope(9)])
    expect(cache.listMessages('a', 'INBOX').map((m) => m.uid)).toEqual([3, 2, 1])
    expect(cache.cachedUids('a', 'INBOX')).toEqual([1, 2, 3])
  })

  it('keeps folder state per account and folder', () => {
    expect(cache.folderState('a', 'INBOX')).toBeNull()
    cache.setFolderState('a', 'INBOX', { uidValidity: '7', highestUid: 3 })
    cache.setFolderState('a', 'INBOX', { uidValidity: '7', highestUid: 5 })
    expect(cache.folderState('a', 'INBOX')).toEqual({ uidValidity: '7', highestUid: 5 })
    expect(cache.folderState('b', 'INBOX')).toBeNull()
  })

  it('updates flags and reports how many changed', () => {
    cache.upsertMessages('a', 'INBOX', [envelope(1), envelope(2)])
    const changed = cache.updateFlags('a', 'INBOX', [
      { uid: 1, seen: true, flagged: true, answered: false },
      { uid: 2, seen: false, flagged: false, answered: false },
    ])
    expect(changed).toBe(1)
    expect(cache.getMessage('a', 'INBOX', 1)).toMatchObject({ seen: true, flagged: true })
  })

  it('stores bodies, fills the preview, and finds words from the body', () => {
    cache.upsertMessages('a', 'INBOX', [envelope(1), envelope(2, { subject: 'Lunch' })])
    cache.setBody('a', 'INBOX', 1, body)
    expect(cache.getBody('a', 'INBOX', 1)).toMatchObject({
      text: body.text,
      attachments: body.attachments,
    })
    expect(cache.listMessages('a', 'INBOX').find((m) => m.uid === 1)?.preview).toBe(body.preview)
    expect(cache.uidsWithoutBody('a', 'INBOX', 10, 10_000)).toEqual([2])

    expect(cache.search('a', 'quartals').map((m) => m.uid)).toEqual([1])
    expect(cache.search('a', 'olpreis').map((m) => m.uid)).toEqual([1]) // diacritics ignored
    expect(cache.search('a', 'lunch').map((m) => m.uid)).toEqual([2])
    expect(cache.search('a', 'bob lunch').map((m) => m.uid)).toEqual([2])
    expect(cache.search('b', 'lunch')).toEqual([])
  })

  it('keeps the search index in step with removals and resets', () => {
    cache.upsertMessages('a', 'INBOX', [
      envelope(1, { subject: 'Alpha' }),
      envelope(2, { subject: 'Alpha two' }),
    ])
    cache.removeMessages('a', 'INBOX', [1])
    expect(cache.search('a', 'alpha').map((m) => m.uid)).toEqual([2])
    cache.resetFolder('a', 'INBOX')
    expect(cache.search('a', 'alpha')).toEqual([])
    expect(cache.listMessages('a', 'INBOX')).toEqual([])
  })

  it('updating a message keeps its body, indexed once and still searchable', () => {
    cache.upsertMessages('a', 'INBOX', [envelope(1, { subject: 'Report' })])
    cache.setBody('a', 'INBOX', 1, body)
    cache.upsertMessages('a', 'INBOX', [envelope(1, { subject: 'Report', seen: true })])
    expect(cache.getBody('a', 'INBOX', 1)).not.toBeNull()
    expect(cache.search('a', 'report')).toHaveLength(1)
    expect(cache.search('a', 'quartals').map((m) => m.uid)).toEqual([1])
  })

  it('forgets everything about a removed account', () => {
    cache.upsertMessages('a', 'INBOX', [envelope(1)])
    cache.upsertMessages('b', 'INBOX', [envelope(1)])
    cache.deleteAccount('a')
    expect(cache.listMessages('a', 'INBOX')).toEqual([])
    expect(cache.listMessages('b', 'INBOX')).toHaveLength(1)
  })
})

describe('MailCache schema', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mailclient-cache-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('rebuilds a cache with an outdated schema instead of failing', () => {
    const path = join(dir, 'cache.sqlite')
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE messages (whatever TEXT); PRAGMA user_version = 0;')
    old.close()

    const rebuilt = new MailCache(path)
    rebuilt.upsertMessages('a', 'INBOX', [envelope(1)])
    expect(rebuilt.listMessages('a', 'INBOX')).toHaveLength(1)
    rebuilt.close()
  })

  it('keeps data across restarts', () => {
    const path = join(dir, 'cache.sqlite')
    const first = new MailCache(path)
    first.upsertMessages('a', 'INBOX', [envelope(1)])
    first.close()
    const second = new MailCache(path)
    expect(second.listMessages('a', 'INBOX')).toHaveLength(1)
    second.close()
  })
})

describe('toSearchQuery', () => {
  it('turns words into prefix terms and drops syntax', () => {
    expect(toSearchQuery('Bob  "lunch" OR')).toBe('"bob"* "lunch"* "or"*')
    expect(toSearchQuery('alice@mailclient.test')).toBe('"alice@mailclient.test"*')
    expect(toSearchQuery('  ')).toBeNull()
  })
})
