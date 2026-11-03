import type { ConnectionSecurity, ImapSmtpSettings, ServerSettings } from '@shared/types/account'
import type { Account } from '@shared/types/mail'
import { createQueue, readJsonFile, writeJsonFile } from '../storage/json-file'

/** An account as saved on disk. Contains no password; that lives in the secret store. */
export interface StoredAccount extends Account {
  kind: 'imap'
  settings: ImapSmtpSettings
  /** ISO 8601 */
  createdAt: string
}

interface AccountsFile {
  version: 1
  accounts: StoredAccount[]
}

const SECURITY: ConnectionSecurity[] = ['tls', 'starttls']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isServer(value: unknown): value is ServerSettings {
  return (
    isRecord(value) &&
    typeof value['host'] === 'string' &&
    Number.isInteger(value['port']) &&
    SECURITY.includes(value['security'] as ConnectionSecurity)
  )
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!isRecord(value) || !isRecord(value['settings'])) return false
  const settings = value['settings']
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['senderName'] === 'string' &&
    typeof value['email'] === 'string' &&
    value['kind'] === 'imap' &&
    typeof value['createdAt'] === 'string' &&
    isServer(settings['imap']) &&
    isServer(settings['smtp']) &&
    typeof settings['username'] === 'string' &&
    typeof settings['acceptSelfSignedLocalCertificate'] === 'boolean'
  )
}

/** Validates the file content. A damaged file is reported, never silently replaced. */
export function parseAccountsFile(value: unknown): StoredAccount[] {
  if (value === undefined) return []
  if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['accounts'])) {
    throw new Error('The account list has an unknown format.')
  }
  const accounts = value['accounts'] as unknown[]
  const invalid = accounts.findIndex((a) => !isStoredAccount(a))
  if (invalid !== -1) throw new Error(`Entry ${invalid + 1} in the account list is damaged.`)
  return accounts as StoredAccount[]
}

/** The account list in `accounts.json` inside the app's data folder. */
export class AccountStore {
  private readonly queue = createQueue()

  constructor(private readonly path: string) {}

  load(): Promise<StoredAccount[]> {
    return this.queue(async () => parseAccountsFile(await readJsonFile(this.path)))
  }

  save(accounts: StoredAccount[]): Promise<void> {
    const file: AccountsFile = { version: 1, accounts }
    return this.queue(() => writeJsonFile(this.path, file))
  }
}
