import { hasErrors, validateNewAccount } from '@shared/account-validation'
import type { AccountsApi } from '@shared/ipc-contract'
import type { AddAccountResult, NewAccountInput } from '@shared/types/account'
import type { Account, AccountId } from '@shared/types/mail'
import type { ConnectionChecker } from '../providers/imap-smtp/check-connection'
import type { MailProvider } from '../providers/types'
import { createQueue } from '../storage/json-file'
import type { AccountStore, StoredAccount } from './account-store'
import { KEYCHAIN_UNAVAILABLE, type EncryptedSecretStore } from './secret-store'

/** Where MailService gets the provider for an account. */
export interface MailProviderSource {
  mailProviders(): Promise<MailProvider[]>
  provider(accountId: AccountId): Promise<MailProvider>
}

export interface AccountServiceDeps {
  store: Pick<AccountStore, 'load' | 'save'>
  secrets: Pick<EncryptedSecretStore, 'isAvailable' | 'get' | 'set' | 'delete' | 'retainOnly'>
  checker: ConnectionChecker
  createProvider(account: StoredAccount, getPassword: () => Promise<string>): MailProvider
  /** Shown while no account has been added, so the app is never empty. */
  sampleProvider: MailProvider
  newId(): string
  now(): Date
  /** Told after an account was added or removed, e.g. to start watching it or drop its cache. */
  onChange?(change: { type: 'added' | 'removed'; accountId: AccountId }): void
}

export function toAccount({ id, name, senderName, email, kind }: StoredAccount): Account {
  return { id, name, senderName, email, kind }
}

/**
 * Adds, lists and removes accounts, and owns one mail provider per account.
 * Settings go to the account store, passwords to the encrypted secret store.
 */
export class AccountService implements AccountsApi, MailProviderSource {
  private accounts: Promise<StoredAccount[]> | null = null
  private readonly providers = new Map<AccountId, MailProvider>()
  /** Adds, removes and cleanups run one at a time, so none works on a stale account list. */
  private readonly mutate = createQueue()
  private cleanedUp = false

  constructor(private readonly deps: AccountServiceDeps) {}

  async list(): Promise<Account[]> {
    return (await this.mailProviders()).map((p) => p.account)
  }

  async add(input: NewAccountInput): Promise<AddAccountResult> {
    const errors = validateNewAccount(input)
    if (hasErrors(errors)) throw new Error(Object.values(errors)[0])
    if (!(await this.deps.secrets.isAvailable())) throw new Error(KEYCHAIN_UNAVAILABLE)
    this.assertNotAdded(await this.load(), input.email)

    // The connection check can take seconds, so it runs outside the queue.
    const { imap, smtp } = await this.deps.checker.check(input.settings, input.password)
    if (!imap.ok || !smtp.ok) return { status: 'failed', imap, smtp }

    return this.mutate(async () => {
      const accounts = await this.load()
      this.assertNotAdded(accounts, input.email)
      const stored: StoredAccount = {
        id: this.deps.newId(),
        kind: 'imap',
        name: input.name.trim(),
        senderName: input.senderName.trim(),
        email: input.email.trim(),
        settings: {
          ...input.settings,
          imap: { ...input.settings.imap, host: input.settings.imap.host.trim() },
          smtp: { ...input.settings.smtp, host: input.settings.smtp.host.trim() },
          username: input.settings.username.trim(),
        },
        createdAt: this.deps.now().toISOString(),
      }

      // Password first: an account in the list must always have its password.
      await this.deps.secrets.set(stored.id, input.password)
      try {
        await this.deps.store.save([...accounts, stored])
      } catch (error) {
        await this.deps.secrets.delete(stored.id).catch(() => undefined)
        throw error
      }
      this.accounts = Promise.resolve([...accounts, stored])
      this.deps.onChange?.({ type: 'added', accountId: stored.id })
      return { status: 'added' as const, account: toAccount(stored) }
    })
  }

  remove(accountId: AccountId): Promise<void> {
    return this.mutate(async () => {
      const accounts = await this.load()
      if (!accounts.some((a) => a.id === accountId)) {
        throw new Error(`Unknown account: ${accountId}`)
      }
      const remaining = accounts.filter((a) => a.id !== accountId)
      // Account first, then its password. If deleting the password fails, the
      // cleanup on the next start removes it (see load).
      await this.deps.store.save(remaining)
      this.accounts = Promise.resolve(remaining)
      const provider = this.providers.get(accountId)
      this.providers.delete(accountId)
      try {
        this.deps.onChange?.({ type: 'removed', accountId })
      } catch {
        // Cache cleanup must not stop the password deletion below.
      }
      await provider?.close().catch(() => undefined)
      await this.deps.secrets.delete(accountId)
    })
  }

  async mailProviders(): Promise<MailProvider[]> {
    const accounts = await this.load()
    if (accounts.length === 0) return [this.deps.sampleProvider]
    return accounts.map((account) => this.providerFor(account))
  }

  async provider(accountId: AccountId): Promise<MailProvider> {
    const provider = (await this.mailProviders()).find((p) => p.account.id === accountId)
    if (!provider) throw new Error(`Unknown account: ${accountId}`)
    return provider
  }

  private load(): Promise<StoredAccount[]> {
    if (!this.accounts) {
      this.accounts = this.deps.store.load().then((accounts) => {
        this.cleanUpOnce(accounts)
        return accounts
      })
      // Don't cache a failed load: the next call tries again.
      this.accounts.catch(() => (this.accounts = null))
    }
    return this.accounts
  }

  /**
   * Deletes passwords whose account no longer exists, e.g. after a removal
   * whose password deletion failed. Runs once, through the mutation queue, so
   * it can never race with an account being added.
   */
  private cleanUpOnce(accounts: StoredAccount[]) {
    if (this.cleanedUp) return
    this.cleanedUp = true
    const ids = accounts.map((a) => a.id)
    void this.mutate(() => this.deps.secrets.retainOnly(ids)).catch(() => undefined)
  }

  private assertNotAdded(accounts: StoredAccount[], email: string) {
    const normalized = email.trim().toLowerCase()
    if (accounts.some((a) => a.email.toLowerCase() === normalized)) {
      throw new Error(`${email.trim()} has already been added.`)
    }
  }

  private providerFor(account: StoredAccount): MailProvider {
    let provider = this.providers.get(account.id)
    if (!provider) {
      provider = this.deps.createProvider(account, () => this.deps.secrets.get(account.id))
      this.providers.set(account.id, provider)
    }
    return provider
  }
}
