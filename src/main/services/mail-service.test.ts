import { describe, expect, it } from 'vitest'
import type { Account, Folder, Message, MessageSummary } from '@shared/types/mail'
import type { MailProvider } from '../providers/types'
import { MailService } from './mail-service'

/** Minimal provider whose every answer is tagged with its account id. */
class TaggedProvider implements MailProvider {
  readonly account: Account

  constructor(id: string) {
    this.account = { id, name: id, email: `${id}@example.org`, kind: 'mock' }
  }

  async listFolders(): Promise<Folder[]> {
    const accountId = this.account.id
    return [
      {
        id: 'inbox',
        accountId,
        name: `${accountId} inbox`,
        role: 'inbox',
        unreadCount: 0,
        totalCount: 1,
      },
    ]
  }

  async listMessages(folderId: string): Promise<MessageSummary[]> {
    return [this.message(`${this.account.id}:${folderId}:1`, folderId)]
  }

  async getMessage(messageId: string): Promise<Message | null> {
    return { ...this.message(messageId, 'inbox'), to: [], cc: [], bodyText: '', attachments: [] }
  }

  private message(id: string, folderId: string): MessageSummary {
    return {
      id,
      accountId: this.account.id,
      folderId,
      from: { email: 'someone@example.org' },
      subject: '',
      preview: '',
      date: '2026-11-03T09:00:00.000Z',
      isRead: true,
      isFlagged: false,
      hasAttachments: false,
    }
  }
}

describe('MailService', () => {
  const service = new MailService([new TaggedProvider('work'), new TaggedProvider('private')])

  it('lists one account per provider, in order', async () => {
    const accounts = await service.listAccounts()
    expect(accounts.map((a) => a.id)).toEqual(['work', 'private'])
  })

  it('routes listFolders to the provider of the requested account', async () => {
    expect((await service.listFolders('private'))[0]?.name).toBe('private inbox')
    expect((await service.listFolders('work'))[0]?.name).toBe('work inbox')
  })

  it('routes listMessages to the provider of the requested account', async () => {
    const [first] = await service.listMessages('private', 'inbox')
    expect(first?.accountId).toBe('private')
    expect(first?.id).toBe('private:inbox:1')
  })

  it('routes getMessage to the provider of the requested account', async () => {
    const message = await service.getMessage('work', 'm-1')
    expect(message?.accountId).toBe('work')
  })

  it('rejects unknown accounts with a clear error', async () => {
    await expect(service.listFolders('nope')).rejects.toThrow('Unknown account: nope')
    await expect(service.listMessages('nope', 'inbox')).rejects.toThrow('Unknown account: nope')
    await expect(service.getMessage('nope', 'm-1')).rejects.toThrow('Unknown account: nope')
  })
})
