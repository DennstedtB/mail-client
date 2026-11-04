import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailChange } from '@shared/types/mail'
import { MailCache } from '../cache/mail-cache'
import { decodeMessageId } from '../mail/message-ref'
import type { MailProvider } from '../providers/types'
import { MOCK_ACCOUNT_ID, MockMailProvider } from '../providers/mock/mock-mail-provider'
import type { AttachmentFiles } from './attachment-files'
import { MailService, WATCH_RETRY_MS } from './mail-service'

let cache: MailCache
let emitted: MailChange[]
let files: AttachmentFiles & { open: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> }

function service(providers: MailProvider[]) {
  return new MailService({
    source: {
      mailProviders: async () => providers,
      provider: async (id) => {
        const provider = providers.find((p) => p.account.id === id)
        if (!provider) throw new Error(`Unknown account: ${id}`)
        return provider
      },
    },
    cache,
    emit: (change) => emitted.push(change),
    files,
  })
}

beforeEach(() => {
  cache = new MailCache(':memory:')
  emitted = []
  files = { open: vi.fn(async () => undefined), save: vi.fn(async () => true) }
})
afterEach(() => cache.close())

describe('MailService', () => {
  it('lists messages from the cache once a folder was synced, and tells the UI', async () => {
    const mail = service([new MockMailProvider()])
    expect(await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).toEqual([])

    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const messages = await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((m) => m.folderId === 'inbox' && m.accountId === MOCK_ACCOUNT_ID)).toBe(
      true,
    )
    expect(emitted).toContainEqual({ accountId: MOCK_ACCOUNT_ID, folderId: 'inbox' })
  })

  it('joins a running sync, then syncs once more for what arrived meanwhile', async () => {
    const provider = new MockMailProvider()
    const sync = vi.spyOn(provider, 'syncFolder')
    const mail = service([provider])
    await Promise.all([
      mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox'),
      mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox'),
      mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox'),
    ])
    expect(sync).toHaveBeenCalledTimes(2)
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    expect(sync).toHaveBeenCalledTimes(3)
  })

  it('tries a failed sync for new mail again later', async () => {
    vi.useFakeTimers()
    try {
      const provider = new MockMailProvider()
      let report: (folderId: string) => void = () => {}
      vi.spyOn(provider, 'watch').mockImplementation((onChange) => {
        report = onChange
        return () => {}
      })
      const original = provider.syncFolder.bind(provider)
      let failed = false
      const sync = vi.spyOn(provider, 'syncFolder').mockImplementation(async (folderId, c) => {
        if (folderId === 'inbox' && !failed) {
          failed = true
          throw new Error('offline')
        }
        return original(folderId, c)
      })
      const inboxSyncs = () => sync.mock.calls.filter(([folderId]) => folderId === 'inbox').length
      const mail = service([provider])
      await mail.watchAll()
      report('inbox')
      await vi.advanceTimersByTimeAsync(0)
      expect(inboxSyncs()).toBe(1)
      await vi.advanceTimersByTimeAsync(WATCH_RETRY_MS)
      expect(inboxSyncs()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('syncs every folder once in the background, so search finds mail everywhere', async () => {
    const mail = service([new MockMailProvider()])
    await mail.watchAll()
    await vi.waitFor(async () =>
      expect((await mail.listMessages(MOCK_ACCOUNT_ID, 'sent')).length).toBeGreaterThan(0),
    )
    const [sent] = await mail.listMessages(MOCK_ACCOUNT_ID, 'sent')
    const word = sent!.subject.split(/\s+/).find((w) => w.length > 4)!
    expect((await mail.search(MOCK_ACCOUNT_ID, word)).map((m) => m.id)).toContain(sent!.id)
  })

  it('creates folders and tells the UI', async () => {
    const mail = service([new MockMailProvider()])
    expect(await mail.createFolder(MOCK_ACCOUNT_ID, ' Projects ')).toBe('Projects')
    expect((await mail.listFolders(MOCK_ACCOUNT_ID)).map((f) => f.name)).toContain('Projects')
    expect(emitted).toContainEqual({ accountId: MOCK_ACCOUNT_ID })
    await expect(mail.createFolder(MOCK_ACCOUNT_ID, '  ')).rejects.toThrow('needs a name')
  })

  it('reports no change when a sample folder is synced again unchanged', async () => {
    const provider = new MockMailProvider()
    expect(await provider.syncFolder('inbox', cache)).toBe(true)
    expect(await provider.syncFolder('inbox', cache)).toBe(false)
  })

  it('returns full messages with recipients and attachments', async () => {
    const mail = service([new MockMailProvider()])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const summary = (await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).find(
      (m) => m.hasAttachments,
    )!
    const message = await mail.getMessage(MOCK_ACCOUNT_ID, summary.id)
    expect(message?.bodyText.length).toBeGreaterThan(0)
    expect(message?.to.length).toBeGreaterThan(0)
    expect(message?.attachments.length).toBeGreaterThan(0)
  })

  it('downloads a body on first open when it is not cached yet', async () => {
    const provider = new MockMailProvider()
    const mail = service([provider])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const [first] = await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')
    const row = cache.getMessage(MOCK_ACCOUNT_ID, 'inbox', decodeMessageId(first!.id).uid)!
    // Envelope only, as after a sync that hasn't prefetched the body yet.
    cache.resetFolder(MOCK_ACCOUNT_ID, 'inbox')
    cache.upsertMessages(MOCK_ACCOUNT_ID, 'inbox', [row])
    expect(cache.getBody(MOCK_ACCOUNT_ID, 'inbox', row.uid)).toBeNull()

    const fetch = vi.spyOn(provider, 'fetchMessage')
    const message = await mail.getMessage(MOCK_ACCOUNT_ID, first!.id)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(message?.bodyText.length).toBeGreaterThan(0)
    await mail.getMessage(MOCK_ACCOUNT_ID, first!.id)
    expect(fetch).toHaveBeenCalledTimes(1) // cached now

    expect(await mail.getMessage(MOCK_ACCOUNT_ID, 'not-an-id').catch((e: Error) => e.message)).toBe(
      'Unknown message.',
    )
  })

  it('returns null for a message that is no longer cached', async () => {
    const mail = service([new MockMailProvider()])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const [first] = await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')
    cache.resetFolder(MOCK_ACCOUNT_ID, 'inbox')
    await expect(mail.getMessage(MOCK_ACCOUNT_ID, first!.id)).resolves.toBeNull()
  })

  it('hands attachments to the file helper for opening and saving', async () => {
    const mail = service([new MockMailProvider()])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const summary = (await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).find(
      (m) => m.hasAttachments,
    )!
    const message = await mail.getMessage(MOCK_ACCOUNT_ID, summary.id)
    const attachmentId = message!.attachments[0]!.id

    await mail.openAttachment(MOCK_ACCOUNT_ID, summary.id, attachmentId)
    await expect(mail.saveAttachment(MOCK_ACCOUNT_ID, summary.id, attachmentId)).resolves.toBe(true)
    expect(files.open).toHaveBeenCalledWith(
      expect.objectContaining({ filename: message!.attachments[0]!.filename }),
    )
    expect(files.save).toHaveBeenCalledTimes(1)
  })

  it('watches each account once, and stops and forgets a removed one', async () => {
    const provider = new MockMailProvider()
    const stop = vi.fn()
    const watch = vi.spyOn(provider, 'watch').mockReturnValue(stop)
    const mail = service([provider])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')

    await mail.watchAll()
    await mail.watchAll()
    expect(watch).toHaveBeenCalledTimes(1)

    mail.forget(MOCK_ACCOUNT_ID)
    expect(stop).toHaveBeenCalled()
    expect(await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).toEqual([])
  })

  it('syncs a folder when its watcher reports a change', async () => {
    const provider = new MockMailProvider()
    let report: ((folder: string) => void) | undefined
    vi.spyOn(provider, 'watch').mockImplementation((onChange) => {
      report = onChange
      return () => {}
    })
    const mail = service([provider])
    await mail.watchAll()
    report!('inbox')
    await vi.waitFor(async () =>
      expect((await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).length).toBeGreaterThan(0),
    )
  })

  it('changes flags in the cache first, then on the server', async () => {
    const provider = new MockMailProvider()
    const setFlags = vi.spyOn(provider, 'setFlags')
    const mail = service([provider])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const unread = (await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).find((m) => !m.isRead)!
    emitted = []
    await mail.setFlags(MOCK_ACCOUNT_ID, [unread.id], { seen: true, flagged: true })
    const after = (await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).find(
      (m) => m.id === unread.id,
    )
    expect(after).toMatchObject({ isRead: true, isFlagged: true })
    expect(setFlags).toHaveBeenCalledWith('inbox', [expect.any(Number)], {
      seen: true,
      flagged: true,
    })
    expect(emitted).toContainEqual({ accountId: MOCK_ACCOUNT_ID, folderId: 'inbox' })
  })

  it('puts flags back from the server when it refuses a change', async () => {
    const provider = new MockMailProvider()
    vi.spyOn(provider, 'setFlags').mockRejectedValue(new Error('Server says no'))
    const mail = service([provider])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const unread = (await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).find((m) => !m.isRead)!
    await expect(mail.setFlags(MOCK_ACCOUNT_ID, [unread.id], { seen: true })).rejects.toThrow(
      'Server says no',
    )
    const after = (await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).find(
      (m) => m.id === unread.id,
    )
    expect(after?.isRead).toBe(false)
  })

  it('moves messages: they leave the list at once and show up in the target', async () => {
    const provider = new MockMailProvider()
    const mail = service([provider])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const [first, second] = await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')
    await mail.moveMessages(MOCK_ACCOUNT_ID, [first!.id], 'archive')
    const inbox = await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')
    expect(inbox.map((m) => m.id)).not.toContain(first!.id)
    expect(inbox.map((m) => m.id)).toContain(second!.id)
    await vi.waitFor(async () =>
      expect((await mail.listMessages(MOCK_ACCOUNT_ID, 'archive')).map((m) => m.subject)).toContain(
        first!.subject,
      ),
    )
  })

  it('puts messages back when the server refuses to move them', async () => {
    const provider = new MockMailProvider()
    vi.spyOn(provider, 'moveMessages').mockRejectedValue(new Error('No such folder'))
    const mail = service([provider])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const before = await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')
    const opened = await mail.getMessage(MOCK_ACCOUNT_ID, before[0]!.id)
    await expect(mail.moveMessages(MOCK_ACCOUNT_ID, [before[0]!.id], 'nowhere')).rejects.toThrow(
      'No such folder',
    )
    expect(await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).toEqual(before)
    expect(await mail.getMessage(MOCK_ACCOUNT_ID, before[0]!.id)).toEqual(opened)
  })

  it('deletes messages for good', async () => {
    const provider = new MockMailProvider()
    const mail = service([provider])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    const [first] = await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')
    await mail.deleteMessages(MOCK_ACCOUNT_ID, [first!.id])
    expect((await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).map((m) => m.id)).not.toContain(
      first!.id,
    )
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    expect((await mail.listMessages(MOCK_ACCOUNT_ID, 'inbox')).map((m) => m.id)).not.toContain(
      first!.id,
    )
  })

  it('searches all synced folders of an account', async () => {
    const mail = service([new MockMailProvider()])
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'inbox')
    await mail.syncFolder(MOCK_ACCOUNT_ID, 'sent')
    const [message] = await mail.listMessages(MOCK_ACCOUNT_ID, 'sent')
    const word = message!.subject.split(/\s+/).find((w) => w.length > 4)!
    const results = await mail.search(MOCK_ACCOUNT_ID, word.toLowerCase())
    expect(results.map((m) => m.id)).toContain(message!.id)
    expect(results.find((m) => m.id === message!.id)?.folderId).toBe('sent')
    expect(await mail.search(MOCK_ACCOUNT_ID, '   ')).toEqual([])
  })

  it('rejects unknown accounts with a clear error', async () => {
    const mail = service([new MockMailProvider()])
    await expect(mail.listFolders('nope')).rejects.toThrow('Unknown account: nope')
    await expect(mail.syncFolder('nope', 'inbox')).rejects.toThrow('Unknown account: nope')
  })
})
