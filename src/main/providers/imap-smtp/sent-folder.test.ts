import type { ImapFlow, ListResponse } from 'imapflow'
import { describe, expect, it, vi } from 'vitest'
import { describeSendError } from './send-error'
import { pickSentFolder, saveSentCopy } from './sent-folder'

function mailbox(path: string, specialUse?: string, flags: string[] = []): ListResponse {
  return {
    path,
    name: path.split('/').pop() ?? path,
    delimiter: '/',
    flags: new Set(flags),
    specialUse,
    listed: true,
    subscribed: true,
  } as ListResponse
}

describe('pickSentFolder', () => {
  it('prefers the folder marked \\Sent', () => {
    expect(pickSentFolder([mailbox('Sent'), mailbox('Gesendet', '\\Sent')])).toBe('Gesendet')
  })

  it('falls back to common names of top-level folders only', () => {
    expect(pickSentFolder([mailbox('Archive/Sent'), mailbox('Sent Items')])).toBe('Sent Items')
    expect(pickSentFolder([mailbox('INBOX'), mailbox('Archive/Sent Items')])).toBeNull()
    const dotted = { ...mailbox('INBOX.Sent'), delimiter: '.' } as ListResponse
    expect(pickSentFolder([dotted])).toBe('INBOX.Sent')
  })

  it('skips folders that cannot hold mail', () => {
    expect(pickSentFolder([mailbox('Sent', undefined, ['\\Noselect'])])).toBeNull()
    expect(pickSentFolder([mailbox('INBOX')])).toBeNull()
  })
})

describe('saveSentCopy', () => {
  const message = {
    envelope: { from: 'a@x.org', to: ['b@x.org'] },
    raw: Buffer.from('raw'),
    sentCopy: Buffer.from('copy with Bcc'),
    messageId: '<m1@x.org>',
  }

  function fakeClient(found: number[]) {
    return {
      list: vi.fn(async () => [mailbox('INBOX', '\\Inbox'), mailbox('Sent', '\\Sent')]),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      search: vi.fn(async () => found),
      append: vi.fn(async () => ({})),
      mailboxCreate: vi.fn(async (path: string) => ({ path })),
    }
  }

  it('appends the copy, marked as read', async () => {
    const client = fakeClient([])
    expect(await saveSentCopy(client as unknown as ImapFlow, message)).toBe('Sent')
    expect(client.search).toHaveBeenCalledWith(
      { header: { 'message-id': '<m1@x.org>' } },
      { uid: true },
    )
    expect(client.append).toHaveBeenCalledWith(
      'Sent',
      message.sentCopy,
      ['\\Seen'],
      expect.any(Date),
    )
  })

  it('adds no second copy when the server filed the message itself', async () => {
    const client = fakeClient([42])
    expect(await saveSentCopy(client as unknown as ImapFlow, message)).toBe('Sent')
    expect(client.append).not.toHaveBeenCalled()
  })

  it('creates a Sent folder when there is none', async () => {
    const client = { ...fakeClient([]), list: vi.fn(async () => [mailbox('INBOX', '\\Inbox')]) }
    expect(await saveSentCopy(client as unknown as ImapFlow, message)).toBe('Sent')
    expect(client.mailboxCreate).toHaveBeenCalledWith('Sent')
  })
})

describe('describeSendError', () => {
  it('names rejected recipients', () => {
    const error = Object.assign(new Error("Can't send mail - all recipients were rejected"), {
      code: 'EENVELOPE',
      rejected: ['nobody@example.org'],
    })
    expect(describeSendError(error).message).toBe(
      "The message wasn't sent. The server didn't accept this recipient: nobody@example.org.",
    )
  })

  it('explains size limits', () => {
    const error = Object.assign(new Error('Message failed'), {
      code: 'EMESSAGE',
      responseCode: 552,
      response: '552 5.3.4 Message size exceeds fixed limit',
    })
    expect(describeSendError(error).message).toMatch(/larger than the server accepts/)
  })

  it('uses the connection messages for connection problems', () => {
    const error = Object.assign(new Error('Invalid login'), { code: 'EAUTH', response: '535 nope' })
    expect(describeSendError(error).message).toBe(
      "The message wasn't sent. The server rejected the user name or password.",
    )
  })

  it('keeps the server response otherwise', () => {
    const error = Object.assign(new Error('x'), { code: 'EMESSAGE', response: '554 Spam detected' })
    expect(describeSendError(error).message).toBe("The message wasn't sent. 554 Spam detected")
  })
})
