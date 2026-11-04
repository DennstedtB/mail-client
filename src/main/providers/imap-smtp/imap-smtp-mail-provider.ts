import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
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
import type { FlagChange, MailProvider, OutgoingMessage, SendOutcome } from '../types'
import { imapOptions, smtpOptions } from './connection-options'
import { describeConnectionError } from './describe-error'
import { downloadSource, syncImapFolder } from './folder-sync'
import { toFolders } from './folders'
import { FolderWatcher, ImapConnection } from './imap-connection'
import { describeSendError } from './send-error'
import { saveSentCopy } from './sent-folder'

const IMAP_FLAGS: Record<keyof FlagChange, string> = {
  seen: '\\Seen',
  flagged: '\\Flagged',
  answered: '\\Answered',
}

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

  async send(message: OutgoingMessage): Promise<SendOutcome> {
    const transport = nodemailer.createTransport(
      smtpOptions(this.settings, await this.getPassword()),
    )
    let rejected: string[]
    try {
      // Resolves when at least one recipient was accepted; the refused ones are listed.
      const info = await transport.sendMail({ envelope: message.envelope, raw: message.raw })
      rejected = (info.rejected as unknown[]).map(recipientAddress)
    } catch (error) {
      throw describeSendError(error)
    } finally {
      transport.close()
    }
    try {
      const folderId = await this.connection.use((client) => saveSentCopy(client, message))
      return { copy: { saved: true, folderId }, rejected }
    } catch {
      return { copy: { saved: false }, rejected }
    }
  }

  async setFlags(folderId: FolderId, uids: number[], change: FlagChange) {
    if (uids.length === 0) return
    const add: string[] = []
    const remove: string[] = []
    for (const key of Object.keys(IMAP_FLAGS) as (keyof FlagChange)[]) {
      const value = change[key]
      if (value !== undefined) (value ? add : remove).push(IMAP_FLAGS[key])
    }
    try {
      await this.connection.use(async (client) => {
        // A read-write lock (SELECT); syncs use read-only ones (EXAMINE).
        const lock = await client.getMailboxLock(folderId)
        try {
          const range = uids.join(',')
          if (add.length > 0) await client.messageFlagsAdd(range, add, { uid: true })
          if (remove.length > 0) await client.messageFlagsRemove(range, remove, { uid: true })
        } finally {
          lock.release()
        }
      })
    } catch (error) {
      throw readable(error)
    }
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

/** Nodemailer lists refused recipients as strings or as { name, address }. */
function recipientAddress(recipient: unknown): string {
  if (typeof recipient === 'string') return recipient
  if (typeof recipient === 'object' && recipient !== null && 'address' in recipient) {
    return String(recipient.address)
  }
  return String(recipient)
}
