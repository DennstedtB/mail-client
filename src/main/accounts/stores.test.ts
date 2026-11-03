import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountStore, parseAccountsFile, type StoredAccount } from './account-store'
import { EncryptedSecretStore, KEYCHAIN_UNAVAILABLE, type Cipher } from './secret-store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mailclient-test-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const account: StoredAccount = {
  id: 'a1',
  name: 'Work',
  senderName: 'Alice',
  email: 'alice@example.com',
  kind: 'imap',
  createdAt: '2026-11-03T10:00:00.000Z',
  settings: {
    imap: { host: 'imap.example.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.example.com', port: 587, security: 'starttls' },
    username: 'alice@example.com',
    acceptSelfSignedLocalCertificate: false,
  },
}

/** Reversible stand-in for safeStorage: shifts every byte, so ciphertext differs from plain text. */
function fakeCipher(available = true, reEncrypt = false): Cipher & { encrypted: number } {
  const cipher = {
    encrypted: 0,
    isAvailable: async () => available,
    encrypt: async (text: string) => {
      cipher.encrypted++
      return Buffer.from(Buffer.from(text).map((b) => (b + 1) % 256))
    },
    decrypt: async (data: Buffer) => ({
      plainText: Buffer.from(data.map((b) => (b + 255) % 256)).toString(),
      reEncrypt,
    }),
  }
  return cipher
}

describe('AccountStore', () => {
  it('starts empty when there is no file yet', async () => {
    await expect(new AccountStore(join(dir, 'accounts.json')).load()).resolves.toEqual([])
  })

  it('saves and loads accounts, in a file only the user can read', async () => {
    const path = join(dir, 'nested', 'accounts.json')
    const store = new AccountStore(path)
    await store.save([account])
    await expect(new AccountStore(path).load()).resolves.toEqual([account])
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('reports a damaged file instead of replacing it', async () => {
    const path = join(dir, 'accounts.json')
    await writeFile(path, '{ not json')
    await expect(new AccountStore(path).load()).rejects.toThrow('not valid JSON')
    expect(await readFile(path, 'utf8')).toBe('{ not json')
  })
})

describe('parseAccountsFile', () => {
  it('rejects unknown versions and damaged entries', () => {
    expect(() => parseAccountsFile({ version: 2, accounts: [] })).toThrow('unknown format')
    expect(() =>
      parseAccountsFile({
        version: 1,
        accounts: [account, { ...account, settings: { imap: {} } }],
      }),
    ).toThrow('Entry 2')
  })
})

describe('EncryptedSecretStore', () => {
  it('stores only ciphertext and returns the original secret', async () => {
    const path = join(dir, 'credentials.json')
    const store = new EncryptedSecretStore(path, fakeCipher())
    await store.set('a1', 'my-password')

    expect(await readFile(path, 'utf8')).not.toContain('my-password')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await expect(new EncryptedSecretStore(path, fakeCipher()).get('a1')).resolves.toBe(
      'my-password',
    )
  })

  it('keeps secrets of other accounts when one is deleted', async () => {
    const store = new EncryptedSecretStore(join(dir, 'credentials.json'), fakeCipher())
    await Promise.all([store.set('a1', 'one'), store.set('a2', 'two')])
    await store.delete('a1')
    await expect(store.get('a1')).rejects.toThrow('No password')
    await expect(store.get('a2')).resolves.toBe('two')
  })

  it('refuses to store or read secrets without a keychain', async () => {
    const store = new EncryptedSecretStore(join(dir, 'credentials.json'), fakeCipher(false))
    await expect(store.isAvailable()).resolves.toBe(false)
    await expect(store.set('a1', 'x')).rejects.toThrow(KEYCHAIN_UNAVAILABLE)
    await expect(store.get('a1')).rejects.toThrow(KEYCHAIN_UNAVAILABLE)
  })

  it('stores a secret again when the keychain asks for re-encryption', async () => {
    const path = join(dir, 'credentials.json')
    await new EncryptedSecretStore(path, fakeCipher()).set('a1', 'pw')
    const rotating = fakeCipher(true, true)
    await expect(new EncryptedSecretStore(path, rotating).get('a1')).resolves.toBe('pw')
    expect(rotating.encrypted).toBe(1)
  })
})
