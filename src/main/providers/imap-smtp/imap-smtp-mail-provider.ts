import { ImapFlow } from 'imapflow'
import type { ImapSmtpSettings } from '@shared/types/account'
import type { Account, Folder, Message, MessageSummary } from '@shared/types/mail'
import type { MailProvider } from '../types'
import { imapOptions } from './connection-options'
import { describeConnectionError } from './describe-error'
import { toFolders } from './folders'

export const MESSAGES_ARRIVE_LATER = 'Reading messages arrives in M2.'

/**
 * Mail provider for IMAP/SMTP accounts. M1 lists folders with their counts;
 * messages, the local cache and push (IDLE) follow in M2. Until then each call
 * opens its own short connection.
 */
export class ImapSmtpMailProvider implements MailProvider {
  constructor(
    readonly account: Account,
    private readonly settings: ImapSmtpSettings,
    private readonly getPassword: () => Promise<string>,
  ) {}

  async listFolders(): Promise<Folder[]> {
    const client = new ImapFlow(imapOptions(this.settings, await this.getPassword()))
    client.on('error', () => {})
    try {
      await client.connect()
      const mailboxes = await client.list({ statusQuery: { messages: true, unseen: true } })
      return toFolders(this.account.id, mailboxes)
    } catch (error) {
      throw new Error(describeConnectionError(error).message, { cause: error })
    } finally {
      await client.logout().catch(() => client.close())
    }
  }

  async listMessages(): Promise<MessageSummary[]> {
    throw new Error(MESSAGES_ARRIVE_LATER)
  }

  async getMessage(): Promise<Message | null> {
    throw new Error(MESSAGES_ARRIVE_LATER)
  }
}
