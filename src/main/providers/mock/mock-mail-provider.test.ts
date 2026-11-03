import { describe, expect, it } from 'vitest'
import { makePreview, MockMailProvider } from './mock-mail-provider'

const NOW = new Date('2026-11-03T09:00:00Z')

describe('MockMailProvider', () => {
  const provider = new MockMailProvider(NOW)

  it('reports unread and total counts that match the messages', async () => {
    const folders = await provider.listFolders()
    for (const folder of folders) {
      const messages = await provider.listMessages(folder.id)
      expect(folder.totalCount).toBe(messages.length)
      expect(folder.unreadCount).toBe(messages.filter((m) => !m.isRead).length)
    }
  })

  it('has exactly one inbox', async () => {
    const folders = await provider.listFolders()
    expect(folders.filter((f) => f.role === 'inbox')).toHaveLength(1)
  })

  it('lists messages newest first, all dated before now', async () => {
    const messages = await provider.listMessages('inbox')
    const times = messages.map((m) => Date.parse(m.date))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(Math.max(...times)).toBeLessThan(NOW.getTime())
  })

  it('returns the full message, or null for an unknown id', async () => {
    const [first] = await provider.listMessages('inbox')
    const message = await provider.getMessage(first!.id)
    expect(message?.bodyText.length).toBeGreaterThan(0)
    expect(message?.hasAttachments).toBe((message?.attachments.length ?? 0) > 0)
    await expect(provider.getMessage('does-not-exist')).resolves.toBeNull()
  })
})

describe('makePreview', () => {
  it('collapses whitespace into one line', () => {
    expect(makePreview('Hello\n\n  world\tagain')).toBe('Hello world again')
  })

  it('shortens long text with an ellipsis', () => {
    const preview = makePreview('word '.repeat(100), 20)
    expect(preview.length).toBeLessThanOrEqual(20)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('returns an empty preview for a length limit of zero or less', () => {
    expect(makePreview('Hello world', 0)).toBe('')
    expect(makePreview('Hello world', -5)).toBe('')
  })
})
