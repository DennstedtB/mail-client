import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MailCache } from '../../cache/mail-cache'
import { MockMailProvider } from './mock-mail-provider'

const NOW = new Date('2026-11-03T09:00:00Z')

let cache: MailCache
beforeEach(() => {
  cache = new MailCache(':memory:')
})
afterEach(() => cache.close())

describe('MockMailProvider', () => {
  const provider = new MockMailProvider(NOW)

  it('fills the cache with folder counts that match its messages', async () => {
    for (const folder of await provider.listFolders()) {
      await provider.syncFolder(folder.id, cache)
      const rows = cache.listMessages(provider.account.id, folder.id)
      expect(rows).toHaveLength(folder.totalCount)
      expect(rows.filter((r) => !r.seen)).toHaveLength(folder.unreadCount)
    }
  })

  it('has exactly one inbox, with dates before now and bodies ready', async () => {
    const folders = await provider.listFolders()
    expect(folders.filter((f) => f.role === 'inbox')).toHaveLength(1)
    await provider.syncFolder('inbox', cache)
    const rows = cache.listMessages(provider.account.id, 'inbox')
    expect(Math.max(...rows.map((r) => Date.parse(r.date)))).toBeLessThan(NOW.getTime())
    expect(cache.uidsWithoutBody(provider.account.id, 'inbox', 100, 1e9)).toEqual([])
  })

  it('returns attachments of sample messages, and reports unknown ones', async () => {
    await provider.syncFolder('inbox', cache)
    const withAttachment = cache
      .listMessages(provider.account.id, 'inbox')
      .find((r) => r.hasAttachments)!
    const ref = { folderId: 'inbox', uid: withAttachment.uid }
    const message = await provider.fetchMessage(ref)
    const attachment = await provider.fetchAttachment(ref, message.attachments[0]!.id)
    expect(attachment.content.length).toBeGreaterThan(0)
    await expect(provider.fetchAttachment(ref, 'nope')).rejects.toThrow('no longer exists')
  })
})
