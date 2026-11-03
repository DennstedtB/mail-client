import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { API_METHODS, type Api } from '@shared/ipc-contract'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  },
}))

const { registerApi } = await import('./ipc')

function fakeEvent(url: string): IpcMainInvokeEvent {
  return { senderFrame: { url } } as unknown as IpcMainInvokeEvent
}

function createFakeApi() {
  const mail = {
    listAccounts: vi.fn(async () => []),
    listFolders: vi.fn(async function (this: unknown, accountId: string) {
      return [{ accountId, sameThis: this === mail }]
    }),
    listMessages: vi.fn(async () => []),
    getMessage: vi.fn(async () => null),
  }
  const app = {
    getInfo: vi.fn(async () => ({ name: 'x', version: '0', platform: 'p', milestone: 'M0' })),
  }
  return { app, mail } as const
}

const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === 'app://ui'

describe('registerApi', () => {
  beforeEach(() => handlers.clear())

  it('registers one handler per method in the contract', () => {
    registerApi(createFakeApi() as unknown as Api, isTrusted)
    const expected = Object.entries(API_METHODS).flatMap(([ns, methods]) =>
      methods.map((m) => `${ns}:${m}`),
    )
    expect([...handlers.keys()].sort()).toEqual(expected.sort())
  })

  it('rejects calls from untrusted senders without running the implementation', () => {
    const api = createFakeApi()
    registerApi(api as unknown as Api, isTrusted)

    const handler = handlers.get('mail:listFolders')!
    expect(() => handler(fakeEvent('https://evil.example/'), 'acc-1')).toThrow(/untrusted sender/)
    expect(api.mail.listFolders).not.toHaveBeenCalled()
  })

  it('passes trusted calls to the implementation with arguments and its own `this`', async () => {
    const api = createFakeApi()
    registerApi(api as unknown as Api, isTrusted)

    const result = await handlers.get('mail:listFolders')!(fakeEvent('app://ui'), 'acc-1')
    expect(api.mail.listFolders).toHaveBeenCalledWith('acc-1')
    expect(result).toEqual([{ accountId: 'acc-1', sameThis: true }])
  })

  it('fails at startup when a contract method has no implementation', () => {
    const api = createFakeApi() as unknown as { mail: Record<string, unknown> }
    delete api.mail['getMessage']
    expect(() => registerApi(api as unknown as Api, isTrusted)).toThrow(
      'Missing implementation for mail:getMessage',
    )
  })
})
