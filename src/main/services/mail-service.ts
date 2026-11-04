import type { MailApi } from '@shared/ipc-contract'
import type {
  AccountId,
  Folder,
  FolderId,
  Message,
  MessageId,
  MessageSummary,
} from '@shared/types/mail'
import type { MailProviderSource } from '../accounts/account-service'

/**
 * Implements the mail part of the IPC contract on top of the provider of
 * each account. From M2 on this is where the local cache (SQLite) and the
 * sync engine plug in: the UI reads from the cache, the providers fill it.
 */
export class MailService implements MailApi {
  constructor(private readonly source: MailProviderSource) {}

  async listFolders(accountId: AccountId): Promise<Folder[]> {
    return (await this.source.provider(accountId)).listFolders()
  }

  async listMessages(accountId: AccountId, folderId: FolderId): Promise<MessageSummary[]> {
    return (await this.source.provider(accountId)).listMessages(folderId)
  }

  async getMessage(accountId: AccountId, messageId: MessageId): Promise<Message | null> {
    return (await this.source.provider(accountId)).getMessage(messageId)
  }
}
