import type {
  Account,
  Folder,
  FolderId,
  Message,
  MessageId,
  MessageSummary,
} from '@shared/types/mail'
import type { MailProvider } from '../types'
import { MOCK_FOLDERS, MOCK_MESSAGES, ME, type MockMessage } from './mock-data'

export const MOCK_ACCOUNT_ID = 'mock'

const PREVIEW_LENGTH = 160

/** Turns a message body into a one-line preview for the message list. */
export function makePreview(bodyText: string, maxLength = PREVIEW_LENGTH): string {
  const singleLine = bodyText.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return `${singleLine.slice(0, maxLength - 1).trimEnd()}…`
}

/**
 * Serves the sample mailbox from mock-data.ts. Replaced by real providers
 * from M1 on; kept afterwards for UI development and tests.
 */
export class MockMailProvider implements MailProvider {
  readonly account: Account = {
    id: MOCK_ACCOUNT_ID,
    name: 'Sample mailbox',
    email: ME.email,
    kind: 'mock',
  }

  private readonly messages: Message[]

  constructor(now: Date = new Date()) {
    this.messages = MOCK_MESSAGES.map((m) => this.toMessage(m, now))
  }

  async listFolders(): Promise<Folder[]> {
    return MOCK_FOLDERS.map((folder) => {
      const inFolder = this.messages.filter((m) => m.folderId === folder.id)
      return {
        ...folder,
        accountId: this.account.id,
        unreadCount: inFolder.filter((m) => !m.isRead).length,
        totalCount: inFolder.length,
      }
    })
  }

  async listMessages(folderId: FolderId): Promise<MessageSummary[]> {
    return this.messages
      .filter((m) => m.folderId === folderId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(toSummary)
  }

  async getMessage(messageId: MessageId): Promise<Message | null> {
    return this.messages.find((m) => m.id === messageId) ?? null
  }

  private toMessage(m: MockMessage, now: Date): Message {
    const attachments = m.attachments ?? []
    return {
      id: m.id,
      accountId: this.account.id,
      folderId: m.folderId,
      from: m.from,
      to: m.to,
      cc: m.cc ?? [],
      subject: m.subject,
      preview: makePreview(m.bodyText),
      date: new Date(now.getTime() - m.minutesAgo * 60_000).toISOString(),
      isRead: m.isRead,
      isFlagged: m.isFlagged ?? false,
      hasAttachments: attachments.length > 0,
      bodyText: m.bodyText,
      attachments,
    }
  }
}

function toSummary(message: Message): MessageSummary {
  const { id, accountId, folderId, from, subject, preview, date, isRead, isFlagged } = message
  return {
    id,
    accountId,
    folderId,
    from,
    subject,
    preview,
    date,
    isRead,
    isFlagged,
    hasAttachments: message.hasAttachments,
  }
}
