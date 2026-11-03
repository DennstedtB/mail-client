import { describe, expect, it } from 'vitest'
import { MOCK_ACCOUNT_ID, MockMailProvider } from '../providers/mock/mock-mail-provider'
import { MailService } from './mail-service'

describe('MailService', () => {
  const service = new MailService([new MockMailProvider()])

  it('lists one account per provider', async () => {
    const accounts = await service.listAccounts()
    expect(accounts.map((a) => a.id)).toEqual([MOCK_ACCOUNT_ID])
  })

  it('routes calls to the provider of the account', async () => {
    const folders = await service.listFolders(MOCK_ACCOUNT_ID)
    expect(folders.length).toBeGreaterThan(0)
    expect(folders.every((f) => f.accountId === MOCK_ACCOUNT_ID)).toBe(true)
  })

  it('rejects unknown accounts with a clear error', async () => {
    await expect(service.listFolders('nope')).rejects.toThrow('Unknown account: nope')
  })
})
