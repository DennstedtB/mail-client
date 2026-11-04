import { ImapFlow } from 'imapflow'
import type { ImapSmtpSettings } from '@shared/types/account'
import type { Account, Folder, FolderId } from '@shared/types/mail'
import type { MailCache } from '../../cache/mail-cache'
import type { MessageRef } from '../../mail/message-ref'
import {
  extractAttachment,
  parseMessage,
  type AttachmentContent,
  type ParsedMessage,
} from '../../mail/parse-message'
import type { MailProvider } from '../types'
import { imapOptions } from './connection-options'
import { describeConnectionError } from './describe-error'
import { downloadSource, syncImapFolder } from './folder-sync'
import { toFolders } from './folders'
import { FolderWatcher, ImapConnection } from './imap-connection'

/** Turns library errors into the readable messages the account dialog uses too. */
function readable(error: unknown): Error {
  if (error instanceof Error && !('code' in error) && !('authenticationFailed' in error))
    return error
  return new Error(describeConnectionError(error).message, { cause: error })
}

/**
 * Mail provider for IMAP/SMTP accounts: one persistent connection for
 * commands, one more that idles on the inbox and reports new mail.
 */
export class ImapSmtpMailProvider implements MailProvider {
  private readonly connection: ImapConnection
  private watcher: FolderWatcher | null = null

  constructor(
    readonly account: Account,
    private readonly settings: ImapSmtpSettings,
    private readonly getPassword: () => Promise<string>,
  ) {
    this.connection = new ImapConnection(this.options)
  }

  private readonly options = async () => imapOptions(this.settings, await this.getPassword())

  async listFolders(): Promise<Folder[]> {
    // A separate short connection: LIST-STATUS shouldn't wait behind a long sync.
    const client = new ImapFlow(await this.options())
    client.on('error', () => {})
    try {
      await client.connect()
      const mailboxes = await client.list({ statusQuery: { messages: true, unseen: true } })
      return toFolders(this.account.id, mailboxes)
    } catch (error) {
      throw readable(error)
    } finally {
      await client.logout().catch(() => client.close())
    }
  }

  async syncFolder(folderId: FolderId, cache: MailCache): Promise<boolean> {
    try {
      return await this.connection.use((client) =>
        syncImapFolder(client, cache, this.account.id, folderId),
      )
    } catch (error) {
      throw readable(error)
    }
  }

  private async source(ref: MessageRef): Promise<Buffer> {
    try {
      return await this.connection.use((client) => downloadSource(client, ref.folderId, ref.uid))
    } catch (error) {
      throw readable(error)
    }
  }

  async fetchMessage(ref: MessageRef): Promise<ParsedMessage> {
    return parseMessage(await this.source(ref))
  }

  async fetchAttachment(ref: MessageRef, attachmentId: string): Promise<AttachmentContent> {
    return extractAttachment(await this.source(ref), attachmentId)
  }

  watch(onChange: (folderId: FolderId) => void): () => void {
    void this.watcher?.stop()
    const watcher = new FolderWatcher({
      options: this.options,
      folder: 'INBOX',
      onChange: () => onChange('INBOX'),
    })
    this.watcher = watcher
    watcher.start()
    return () => {
      void watcher.stop()
      if (this.watcher === watcher) this.watcher = null
    }
  }

  async close() {
    await Promise.all([this.watcher?.stop(), this.connection.close()])
    this.watcher = null
  }
}
