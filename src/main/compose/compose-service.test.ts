import { simpleParser } from 'mailparser'
import { describe, expect, it, vi } from 'vitest'
import type { Draft } from '@shared/types/compose'
import type { Account } from '@shared/types/mail'
import type { CachedBody, CachedRow } from '../cache/mail-cache'
import { encodeMessageId } from '../mail/message-ref'
import type { MailProvider, OutgoingMessage } from '../providers/types'
import { ComposeService, MAX_ATTACHMENT_BYTES } from './compose-service'

const ACCOUNT: Account = {
  id: 'a1',
  name: 'Home',
  senderName: 'Alice Example',
  email: 'alice@example.org',
  kind: 'imap',
}

const SOURCE_ID = encodeMessageId({ folderId: 'INBOX', uid: 7 })

const ROW: CachedRow = {
  folder: 'INBOX',
  uid: 7,
  subject: 'Lunch on Friday',
  from: { name: 'Bob', email: 'bob@example.org' },
  to: [{ email: 'alice@example.org' }, { email: 'carol@example.org' }],
  cc: [{ email: 'dave@example.org' }],
  date: '2026-11-04T09:30:00.000Z',
  seen: true,
  flagged: false,
  answered: false,
  hasAttachments: true,
  size: 1000,
  preview: 'Shall we?',
}

const BODY: CachedBody = {
  text: 'Shall we?\nNoon works for me.',
  attachments: [{ id: '0', filename: 'menu.pdf', mimeType: 'application/pdf', size: 5 }],
  headers: { messageId: '<orig@example.org>', references: ['<root@example.org>'] },
  preview: 'Shall we?',
  to: ROW.to,
  cc: ROW.cc,
}

function setup(
  options: {
    files?: Record<string, Buffer>
    sendError?: Error
    saved?: boolean
    rejected?: string[]
  } = {},
) {
  const sent: OutgoingMessage[] = []
  const provider: MailProvider = {
    account: ACCOUNT,
    listFolders: async () => [],
    syncFolder: async () => false,
    fetchMessage: async () => Promise.reject(new Error('not used')),
    fetchAttachment: async () => ({
      filename: 'menu.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('%PDF-'),
    }),
    send: vi.fn(async (message: OutgoingMessage) => {
      if (options.sendError) throw options.sendError
      sent.push(message)
      return {
        copy:
          options.saved === false
            ? { saved: false as const }
            : { saved: true as const, folderId: 'Sent' },
        rejected: options.rejected ?? [],
      }
    }),
    setFlags: vi.fn(async () => undefined),
    watch: () => () => {},
    close: async () => undefined,
  }
  const files = options.files ?? {}
  const picked: string[] = []
  const mail = {
    loadMessage: vi.fn(async () => ({ row: ROW, body: BODY })),
    setFlags: vi.fn(async () => undefined),
    syncFolder: vi.fn(async () => undefined),
  }
  const service = new ComposeService({
    source: { provider: async () => provider, mailProviders: async () => [provider] },
    mail,
    pickFiles: async () => picked.splice(0),
    fileSize: async (path) => files[path]?.length ?? null,
    readFile: async (path, maxBytes) => {
      const content = files[path]
      if (!content) throw new Error('ENOENT')
      return content.subarray(0, maxBytes + 1)
    },
    now: () => new Date('2026-11-04T10:00:00Z'),
  })
  return { service, provider, sent, mail, pick: (...paths: string[]) => picked.push(...paths) }
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    kind: 'new',
    accountId: ACCOUNT.id,
    to: 'Bob <bob@example.org>',
    cc: '',
    bcc: '',
    subject: 'Hello',
    body: 'Hi Bob',
    attachments: [],
    ...overrides,
  }
}

describe('ComposeService.prepare', () => {
  it('starts a new message empty', async () => {
    const { service } = setup()
    expect(await service.prepare('new', ACCOUNT.id)).toMatchObject({
      to: '',
      subject: '',
      body: '',
    })
  })

  it('prepares a reply to the sender with the quoted text', async () => {
    const { service } = setup()
    const reply = await service.prepare('reply', ACCOUNT.id, SOURCE_ID)
    expect(reply).toMatchObject({
      kind: 'reply',
      to: 'Bob <bob@example.org>',
      cc: '',
      subject: 'Re: Lunch on Friday',
      sourceMessageId: SOURCE_ID,
    })
    expect(reply.body).toContain('Bob <bob@example.org> wrote:\n> Shall we?\n> Noon works for me.')
  })

  it('replies to all others in Cc, without my own address', async () => {
    const { service } = setup()
    const reply = await service.prepare('replyAll', ACCOUNT.id, SOURCE_ID)
    expect(reply.to).toBe('Bob <bob@example.org>')
    expect(reply.cc).toBe('carol@example.org, dave@example.org')
  })

  it('forwards with the original headers and attachments', async () => {
    const { service } = setup()
    const forward = await service.prepare('forward', ACCOUNT.id, SOURCE_ID)
    expect(forward.subject).toBe('Fwd: Lunch on Friday')
    expect(forward.to).toBe('')
    expect(forward.body).toContain('---------- Forwarded message ----------')
    expect(forward.attachments).toEqual([{ id: expect.any(String), filename: 'menu.pdf', size: 5 }])
  })
})

describe('ComposeService.send', () => {
  it('sends to every recipient, and keeps Bcc only in the Sent copy', async () => {
    const { service, sent } = setup()
    const result = await service.send(
      draft({ cc: 'carol@example.org', bcc: 'Secret <secret@example.org>' }),
    )
    expect(result).toEqual({ status: 'sent', copySaved: true, rejected: [] })
    const [message] = sent
    expect(message?.envelope).toEqual({
      from: 'alice@example.org',
      to: ['bob@example.org', 'carol@example.org', 'secret@example.org'],
    })
    const delivered = await simpleParser(message!.raw)
    const copy = await simpleParser(message!.sentCopy)
    expect(delivered.bcc).toBeUndefined()
    expect(copy.bcc).toMatchObject({ value: [{ name: 'Secret', address: 'secret@example.org' }] })
    expect(delivered.from?.value).toEqual([{ name: 'Alice Example', address: 'alice@example.org' }])
    expect(delivered.messageId).toBe(message!.messageId)
    expect(copy.messageId).toBe(message!.messageId)
    expect(message!.messageId).toMatch(/^<[\w-]+@example\.org>$/)
    expect(delivered.text?.trim()).toBe('Hi Bob')
  })

  it('threads replies and marks the original as answered', async () => {
    const { service, sent, mail } = setup()
    const reply = await service.prepare('reply', ACCOUNT.id, SOURCE_ID)
    await service.send(reply)
    const delivered = await simpleParser(sent[0]!.raw)
    expect(delivered.inReplyTo).toBe('<orig@example.org>')
    expect(delivered.references).toEqual(['<root@example.org>', '<orig@example.org>'])
    expect(mail.setFlags).toHaveBeenCalledWith(ACCOUNT.id, [SOURCE_ID], { answered: true })
    expect(mail.syncFolder).toHaveBeenCalledWith(ACCOUNT.id, 'Sent')
  })

  it('attaches picked files and forwarded attachments', async () => {
    const { service, sent, pick } = setup({ files: { '/home/me/notes.txt': Buffer.from('notes') } })
    const forward = await service.prepare('forward', ACCOUNT.id, SOURCE_ID)
    pick('/home/me/notes.txt', '/home/me/a-folder')
    const added = await service.addAttachments()
    expect(added).toEqual([{ id: expect.any(String), filename: 'notes.txt', size: 5 }])
    await service.send({
      ...forward,
      to: 'eve@example.org',
      attachments: [...forward.attachments, ...added],
    })
    const delivered = await simpleParser(sent[0]!.raw)
    expect(delivered.attachments.map((a) => [a.filename, a.content.toString()])).toEqual([
      ['menu.pdf', '%PDF-'],
      ['notes.txt', 'notes'],
    ])
  })

  it('only sends attachments the main process handed out', async () => {
    const { service, provider } = setup()
    const forged = draft({ attachments: [{ id: '/etc/passwd', filename: 'passwd', size: 1 }] })
    await expect(service.send(forged)).rejects.toThrow('no longer available')
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('forgets the tokens after sending or discarding', async () => {
    const { service, pick } = setup({ files: { '/x.txt': Buffer.from('x') } })
    pick('/x.txt')
    const attachments = await service.addAttachments()
    await service.send(draft({ attachments }))
    await expect(service.send(draft({ attachments }))).rejects.toThrow('no longer available')
    pick('/x.txt')
    const again = await service.addAttachments()
    await service.releaseAttachments(again.map((a) => a.id))
    await expect(service.send(draft({ attachments: again }))).rejects.toThrow('no longer available')
  })

  it('reports invalid recipients per field and sends nothing', async () => {
    const { service, provider } = setup()
    expect(await service.send(draft({ to: '' }))).toEqual({
      status: 'invalid',
      field: 'to',
      message: 'Add at least one recipient.',
    })
    expect(await service.send(draft({ cc: 'carol@' }))).toEqual({
      status: 'invalid',
      field: 'cc',
      message: '"carol@" isn\'t an email address.',
    })
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('refuses attachments over the limit', async () => {
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)
    const { service, pick, provider } = setup({ files: { '/big.bin': big } })
    pick('/big.bin')
    const attachments = await service.addAttachments()
    await expect(service.send(draft({ attachments }))).rejects.toThrow(/limit is 18 MB/)
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('passes on send errors, and keeps the attachments for another try', async () => {
    const { service, pick } = setup({
      files: { '/x.txt': Buffer.from('x') },
      sendError: new Error("The message wasn't sent. Refused."),
    })
    pick('/x.txt')
    const attachments = await service.addAttachments()
    await expect(service.send(draft({ attachments }))).rejects.toThrow("wasn't sent")
    await expect(service.send(draft({ attachments }))).rejects.toThrow("wasn't sent")
  })

  it('passes on recipients the server refused', async () => {
    const { service } = setup({ rejected: ['nobody@example.org'] })
    expect(await service.send(draft({ cc: 'nobody@example.org' }))).toEqual({
      status: 'sent',
      copySaved: true,
      rejected: ['nobody@example.org'],
    })
  })

  it('notices a file that grew past the limit after it was picked', async () => {
    const files: Record<string, Buffer> = { '/grows.log': Buffer.from('small') }
    const { service, pick, provider } = setup({ files })
    pick('/grows.log')
    const attachments = await service.addAttachments()
    files['/grows.log'] = Buffer.alloc(MAX_ATTACHMENT_BYTES + 10)
    await expect(service.send(draft({ attachments }))).rejects.toThrow(/limit is 18 MB/)
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('says when the message went out but the copy was not saved', async () => {
    const { service, mail } = setup({ saved: false })
    expect(await service.send(draft())).toEqual({
      status: 'sent',
      copySaved: false,
      rejected: [],
    })
    expect(mail.syncFolder).not.toHaveBeenCalled()
  })
})
