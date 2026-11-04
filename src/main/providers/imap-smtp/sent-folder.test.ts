import type { ListResponse } from 'imapflow'
import { describe, expect, it } from 'vitest'
import { describeSendError } from './send-error'
import { pickSentFolder } from './sent-folder'

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

  it('falls back to common names, and skips folders that cannot hold mail', () => {
    expect(pickSentFolder([mailbox('INBOX'), mailbox('Archive/Sent Items')])).toBe(
      'Archive/Sent Items',
    )
    expect(pickSentFolder([mailbox('Sent', undefined, ['\\Noselect'])])).toBeNull()
    expect(pickSentFolder([mailbox('INBOX')])).toBeNull()
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
