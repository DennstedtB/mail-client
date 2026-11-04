import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseSearch } from '@shared/search-query'
import { MailCache, type CachedBody, type CachedEnvelope } from './mail-cache'

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
    attachmentNames: [],
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

/** UIDs of the messages a search finds, newest first. */
function find(accountId: string, query: string, now?: Date): number[] {
  const { node, problems } = parseSearch(query, { now })
  if (!node || problems.length > 0) throw new Error(`Not a search: ${query}`)
  return cache.search(accountId, node).map((m) => m.uid)
}

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

    expect(find('a', 'quartals')).toEqual([1])
    expect(find('a', 'olpreis')).toEqual([1]) // diacritics ignored
    expect(find('a', 'lunch')).toEqual([2])
    expect(find('a', 'bob lunch')).toEqual([2])
    expect(find('b', 'lunch')).toEqual([])
  })

  it('keeps the search index in step with removals and resets', () => {
    cache.upsertMessages('a', 'INBOX', [
      envelope(1, { subject: 'Alpha' }),
      envelope(2, { subject: 'Alpha two' }),
    ])
    cache.removeMessages('a', 'INBOX', [1])
    expect(find('a', 'alpha')).toEqual([2])
    cache.resetFolder('a', 'INBOX')
    expect(find('a', 'alpha')).toEqual([])
    expect(cache.listMessages('a', 'INBOX')).toEqual([])
  })

  it('updating a message keeps its body, indexed once and still searchable', () => {
    cache.upsertMessages('a', 'INBOX', [envelope(1, { subject: 'Report' })])
    cache.setBody('a', 'INBOX', 1, body)
    cache.upsertMessages('a', 'INBOX', [envelope(1, { subject: 'Report', seen: true })])
    expect(cache.getBody('a', 'INBOX', 1)).not.toBeNull()
    expect(find('a', 'report')).toHaveLength(1)
    expect(find('a', 'quartals')).toEqual([1])
  })

  it('forgets everything about a removed account', () => {
    cache.upsertMessages('a', 'INBOX', [envelope(1)])
    cache.upsertMessages('b', 'INBOX', [envelope(1)])
    cache.deleteAccount('a')
    expect(cache.listMessages('a', 'INBOX')).toEqual([])
    expect(cache.listMessages('b', 'INBOX')).toHaveLength(1)
    expect(find('a', 'message')).toEqual([])
    expect(find('b', 'message')).toEqual([1])
  })
})

describe('MailCache search', () => {
  const day = (month: number, date: number) => new Date(2026, month - 1, date, 12).toISOString()
  const anna = { name: 'Anna Berg', email: 'anna.berg@example.org' }

  beforeEach(() => {
    cache.setFolders('a', [
      { id: 'INBOX', name: 'Inbox', role: 'inbox' },
      { id: 'Sent', name: 'Sent', role: 'sent' },
      { id: 'INBOX.Projekte.Acme', name: 'Acme', role: 'custom' },
    ])
    cache.upsertMessages('a', 'INBOX', [
      envelope(1, {
        subject: 'Invoice March',
        from: anna,
        cc: [{ email: 'carol@example.org' }],
        date: day(11, 1),
        flagged: true,
        hasAttachments: true,
        attachmentNames: ['Rechnung März.pdf'],
        size: 3 * 1024 * 1024,
      }),
      envelope(2, { subject: 'Lunch', to: [anna], date: day(11, 2), seen: true, answered: true }),
      envelope(3, {
        subject: 'Notes from Anna',
        from: { email: 'carol@example.org' },
        cc: [anna],
        date: day(10, 15),
        seen: true,
        size: 500,
      }),
    ])
    cache.upsertMessages('a', 'Sent', [
      envelope(4, {
        subject: 'Re: Lunch',
        to: [{ email: 'bob@mailclient.test' }],
        date: day(11, 3),
      }),
    ])
    cache.upsertMessages('a', 'INBOX.Projekte.Acme', [
      envelope(5, { subject: 'Acme kickoff', date: day(11, 4), seen: true }),
    ])
    cache.upsertMessages('b', 'INBOX', [envelope(1, { from: anna, subject: 'Other account' })])
  })

  it('finds plain words in any field, newest first, in one account', () => {
    expect(find('a', 'anna')).toEqual([2, 1, 3])
    expect(find('b', 'anna')).toEqual([1])
  })

  it('limits from:, to:, cc: and subject: to their field', () => {
    expect(find('a', 'from:anna')).toEqual([1])
    expect(find('a', 'from:anna.berg@example.org')).toEqual([1])
    expect(find('a', 'from:"Anna Be"')).toEqual([1])
    expect(find('a', 'from:@example.org')).toEqual([1, 3])
    expect(find('a', 'to:anna')).toEqual([2, 3]) // To and Cc
    expect(find('a', 'cc:anna')).toEqual([3])
    expect(find('a', 'subject:anna')).toEqual([3])
  })

  it('finds attachment names, also without the body', () => {
    expect(find('a', 'filename:marz')).toEqual([1])
    expect(find('a', 'rechnung')).toEqual([1])
    expect(find('a', 'has:attachment')).toEqual([1])
  })

  it('filters by status, date and size', () => {
    expect(find('a', 'is:unread')).toEqual([4, 1])
    expect(find('a', '-is:read')).toEqual([4, 1])
    expect(find('a', 'is:flagged')).toEqual([1])
    expect(find('a', 'is:replied')).toEqual([2])
    expect(find('a', 'after:2026-11-03')).toEqual([5, 4])
    expect(find('a', 'before:2026-11')).toEqual([3])
    expect(find('a', 'date:2.11.2026')).toEqual([2])
    expect(find('a', 'newer_than:3d', new Date(2026, 10, 4, 18))).toEqual([5, 4, 2])
    expect(find('a', 'larger:2M')).toEqual([1])
    expect(find('a', 'smaller:0.9K')).toEqual([3])
  })

  it('finds folders by role, name or path', () => {
    expect(find('a', 'in:sent')).toEqual([4])
    expect(find('a', 'in:inbox')).toEqual([2, 1, 3])
    expect(find('a', 'in:acme')).toEqual([5])
    expect(find('a', 'in:ac')).toEqual([5])
    expect(find('a', 'folder:INBOX.Projekte.Acme')).toEqual([5])
    expect(find('a', 'in:nowhere')).toEqual([])
    expect(find('a', '-in:inbox')).toEqual([5, 4])
  })

  it('combines terms with OR, brackets and minus', () => {
    expect(find('a', 'from:anna OR from:carol')).toEqual([1, 3])
    expect(find('a', 'anna -from:anna')).toEqual([2, 3])
    expect(find('a', '(lunch OR kickoff) -in:sent')).toEqual([5, 2])
    expect(find('a', 'lunch is:read')).toEqual([2])
  })

  it('keeps attachment names when messages are put back', () => {
    const saved = cache.snapshot('a', 'INBOX', [1])
    cache.removeMessages('a', 'INBOX', [1])
    expect(find('a', 'filename:rechnung')).toEqual([])
    cache.restore('a', 'INBOX', saved)
    expect(find('a', 'filename:rechnung')).toEqual([1])
  })

  it('keeps the folder list per account and forgets it with the account', () => {
    expect(cache.folders('a').map((f) => f.id)).toEqual(['INBOX', 'INBOX.Projekte.Acme', 'Sent'])
    cache.setFolders('a', [{ id: 'INBOX', name: 'Inbox', role: 'inbox' }])
    expect(cache.folders('a')).toEqual([{ id: 'INBOX', name: 'Inbox', role: 'inbox' }])
    cache.deleteAccount('a')
    expect(cache.folders('a')).toEqual([])
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
