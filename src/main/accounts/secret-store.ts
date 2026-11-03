import { createQueue, readJsonFile, writeJsonFile } from '../storage/json-file'

/**
 * Encrypts and decrypts secrets. In the app this is Electron's `safeStorage`,
 * whose key lives in the macOS Keychain; tests use a fake.
 */
export interface Cipher {
  isAvailable(): Promise<boolean>
  encrypt(plainText: string): Promise<Buffer>
  /** `reEncrypt` is true when the key was rotated: the secret should be stored again. */
  decrypt(encrypted: Buffer): Promise<{ plainText: string; reEncrypt: boolean }>
}

export const KEYCHAIN_UNAVAILABLE =
  "Passwords can't be stored securely right now: the system keychain isn't available."

interface SecretsFile {
  version: 1
  /** Account id → encrypted secret, base64 */
  secrets: Record<string, string>
}

function parseSecretsFile(value: unknown): SecretsFile {
  if (value === undefined) return { version: 1, secrets: {} }
  const file = value as Partial<SecretsFile>
  if (file.version !== 1 || typeof file.secrets !== 'object' || file.secrets === null) {
    throw new Error('The password store has an unknown format.')
  }
  return { version: 1, secrets: { ...file.secrets } }
}

/**
 * Account passwords, encrypted with the system keychain and kept in
 * `credentials.json`. Only ciphertext ever touches the disk; plain passwords
 * exist only in memory, and only in the main process.
 */
export class EncryptedSecretStore {
  private readonly queue = createQueue()

  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
  ) {}

  isAvailable(): Promise<boolean> {
    return this.cipher.isAvailable()
  }

  get(accountId: string): Promise<string> {
    return this.queue(async () => {
      await this.assertAvailable()
      const file = parseSecretsFile(await readJsonFile(this.path))
      const encrypted = file.secrets[accountId]
      if (encrypted === undefined) throw new Error('No password is stored for this account.')
      const { plainText, reEncrypt } = await this.cipher.decrypt(Buffer.from(encrypted, 'base64'))
      if (reEncrypt) {
        file.secrets[accountId] = (await this.cipher.encrypt(plainText)).toString('base64')
        await writeJsonFile(this.path, file)
      }
      return plainText
    })
  }

  set(accountId: string, secret: string): Promise<void> {
    return this.queue(async () => {
      await this.assertAvailable()
      const file = parseSecretsFile(await readJsonFile(this.path))
      file.secrets[accountId] = (await this.cipher.encrypt(secret)).toString('base64')
      await writeJsonFile(this.path, file)
    })
  }

  delete(accountId: string): Promise<void> {
    return this.queue(async () => {
      const file = parseSecretsFile(await readJsonFile(this.path))
      if (!(accountId in file.secrets)) return
      delete file.secrets[accountId]
      await writeJsonFile(this.path, file)
    })
  }

  private async assertAvailable() {
    if (!(await this.cipher.isAvailable())) throw new Error(KEYCHAIN_UNAVAILABLE)
  }
}
