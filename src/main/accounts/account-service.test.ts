import { describe, expect, it, vi } from 'vitest'
import type { CheckResult, NewAccountInput } from '@shared/types/account'
import type { MailProvider } from '../providers/types'
import { MockMailProvider } from '../providers/mock/mock-mail-provider'
import { AccountService, type AccountServiceDeps } from './account-service'
import type { StoredAccount } from './account-store'
import { KEYCHAIN_UNAVAILABLE } from './secret-store'

const OK: CheckResult = { ok: true }
const AUTH_FAILED: CheckResult = { ok: false, problem: 'auth', message: 'rejected' }

function input(overrides: Partial<NewAccountInput> = {}): NewAccountInput {
  return {
    name: ' Work ',
    senderName: 'Alice',
    email: 'alice@example.com',
    password: 'secret',
    settings: {
      imap: { host: ' imap.example.com ', port: 993, security: 'tls' },
      smtp: { host: 'smtp.example.com', port: 465, security: 'tls' },
      username: 'alice@example.com',
      acceptSelfSignedLocalCertificate: false,
    },
    ...overrides,
  }
}

function setup(
  options: {
    check?: { imap: CheckResult; smtp: CheckResult }
    keychain?: boolean
    accounts?: StoredAccount[]
    secrets?: Record<string, string>
  } = {},
) {
  let saved: StoredAccount[] = options.accounts ?? []
  const secrets = new Map<string, string>(Object.entries(options.secrets ?? {}))
  let nextId = 1
  const deps = {
    store: {
      load: vi.fn(async () => saved),
      save: vi.fn(async (accounts: StoredAccount[]) => {
        saved = accounts
      }),
    },
    secrets: {
      isAvailable: async () => options.keychain ?? true,
      get: vi.fn(async (id: string) => secrets.get(id) ?? Promise.reject(new Error('none'))),
      set: vi.fn(async (id: string, secret: string) => void secrets.set(id, secret)),
      delete: vi.fn(async (id: string) => void secrets.delete(id)),
      retainOnly: vi.fn(async (ids: string[]) => {
        const orphans = [...secrets.keys()].filter((id) => !ids.includes(id))
        orphans.forEach((id) => secrets.delete(id))
        return orphans
      }),
    },
    checker: { check: vi.fn(async () => options.check ?? { imap: OK, smtp: OK }) },
    createProvider: vi.fn(
      (account: StoredAccount, getPassword: () => Promise<string>): MailProvider => ({
        account,
        listFolders: async () => [
          {
            id: await getPassword(),
            accountId: account.id,
            name: '',
            role: 'inbox',
            unreadCount: 0,
            totalCount: 0,
          },
        ],
        syncFolder: async () => false,
        fetchMessage: async () => Promise.reject(new Error('not used')),
        fetchAttachment: async () => Promise.reject(new Error('not used')),
        watch: () => () => {},
        close: vi.fn(async () => undefined),
      }),
    ),
    sampleProvider: new MockMailProvider(),
    newId: () => `id-${nextId++}`,
    now: () => new Date('2026-11-03T10:00:00Z'),
  } satisfies AccountServiceDeps
  return { service: new AccountService(deps), deps, secrets, saved: () => saved }
}

describe('AccountService', () => {
  it('shows the sample mailbox while no account exists', async () => {
    const { service } = setup()
    expect((await service.list()).map((a) => a.kind)).toEqual(['mock'])
  })

  it('adds an account after both checks pass, with the password only in the secret store', async () => {
    const { service, secrets, saved } = setup()
    const result = await service.add(input())

    expect(result).toEqual({
      status: 'added',
      account: {
        id: 'id-1',
        name: 'Work',
        senderName: 'Alice',
        email: 'alice@example.com',
        kind: 'imap',
      },
    })
    expect(secrets.get('id-1')).toBe('secret')
    expect(JSON.stringify(saved())).not.toContain('secret')
    expect(saved()[0]?.settings.imap.host).toBe('imap.example.com')
    // The sample mailbox disappears once a real account exists.
    expect((await service.list()).map((a) => a.id)).toEqual(['id-1'])
  })

  it('saves nothing when a check fails, and reports both results', async () => {
    const { service, deps } = setup({ check: { imap: OK, smtp: AUTH_FAILED } })
    await expect(service.add(input())).resolves.toEqual({
      status: 'failed',
      imap: OK,
      smtp: AUTH_FAILED,
    })
    expect(deps.store.save).not.toHaveBeenCalled()
    expect(deps.secrets.set).not.toHaveBeenCalled()
  })

  it('rejects invalid input before connecting', async () => {
    const { service, deps } = setup()
    await expect(service.add(input({ email: 'nope' }))).rejects.toThrow('valid email')
    expect(deps.checker.check).not.toHaveBeenCalled()
  })

  it('refuses to add an account when no keychain is available', async () => {
    const { service, deps } = setup({ keychain: false })
    await expect(service.add(input())).rejects.toThrow(KEYCHAIN_UNAVAILABLE)
    expect(deps.checker.check).not.toHaveBeenCalled()
  })

  it('refuses the same email address twice', async () => {
    const { service } = setup()
    await service.add(input())
    await expect(service.add(input({ email: 'ALICE@example.com' }))).rejects.toThrow(
      'already been added',
    )
  })

  it('removes the stored password again if saving the account fails', async () => {
    const { service, deps, secrets } = setup()
    deps.store.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(service.add(input())).rejects.toThrow('disk full')
    expect(secrets.size).toBe(0)
  })

  it('removes an account together with its password', async () => {
    const { service, secrets, saved } = setup()
    await service.add(input())
    await service.remove('id-1')
    expect(saved()).toEqual([])
    expect(secrets.size).toBe(0)
    await expect(service.remove('id-1')).rejects.toThrow('Unknown account')
  })

  it('gives each provider the password from the secret store, on demand', async () => {
    const { service } = setup()
    await service.add(input())
    const provider = await service.provider('id-1')
    await expect(provider.listFolders()).resolves.toMatchObject([{ id: 'secret' }])
    expect(await service.provider('id-1')).toBe(provider)
  })

  it('runs overlapping adds one after the other, so both accounts are kept', async () => {
    const { service, saved } = setup()
    await Promise.all([
      service.add(input({ email: 'one@example.com' })),
      service.add(input({ email: 'two@example.com' })),
    ])
    expect(
      saved()
        .map((a) => a.email)
        .sort(),
    ).toEqual(['one@example.com', 'two@example.com'])
  })

  it('adds the same address only once, even when both adds overlap', async () => {
    const { service, saved } = setup()
    const results = await Promise.allSettled([service.add(input()), service.add(input())])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(saved()).toHaveLength(1)
  })

  it('deletes passwords of accounts that no longer exist when it starts', async () => {
    const existing: StoredAccount = {
      id: 'kept',
      kind: 'imap',
      name: 'Kept',
      senderName: 'Kept',
      email: 'kept@example.com',
      createdAt: '2026-11-03T10:00:00Z',
      settings: input().settings,
    }
    const { service, secrets } = setup({
      accounts: [existing],
      secrets: { kept: 'pw', orphan: 'left over from a failed removal' },
    })
    await service.list()
    await vi.waitFor(() => expect([...secrets.keys()]).toEqual(['kept']))
  })
})
