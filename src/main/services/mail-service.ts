import type { MailApi } from '@shared/ipc-contract'
import type {
  Account,
  AccountId,
  Folder,
  FolderId,
  Message,
  MessageId,
  MessageSummary,
} from '@shared/types/mail'
import type { MailProvider } from '../providers/types'

/**
 * Implements the mail part of the IPC contract on top of any number of
 * providers, one per account. From M2 on this is where the local cache
 * (SQLite) and the sync engine plug in: the UI reads from the cache, the
 * providers fill it.
 */
export class MailService implements MailApi {
  private readonly providers = new Map<AccountId, MailProvider>()

  constructor(providers: MailProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.account.id, provider)
    }
  }

  async listAccounts(): Promise<Account[]> {
    return [...this.providers.values()].map((p) => p.account)
  }

  async listFolders(accountId: AccountId): Promise<Folder[]> {
    return this.provider(accountId).listFolders()
  }

  async listMessages(accountId: AccountId, folderId: FolderId): Promise<MessageSummary[]> {
    return this.provider(accountId).listMessages(folderId)
  }

  async getMessage(accountId: AccountId, messageId: MessageId): Promise<Message | null> {
    return this.provider(accountId).getMessage(messageId)
  }

  private provider(accountId: AccountId): MailProvider {
    const provider = this.providers.get(accountId)
    if (!provider) throw new Error(`Unknown account: ${accountId}`)
    return provider
  }
}
