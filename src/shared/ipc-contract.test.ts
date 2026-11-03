import { describe, expect, it, vi } from 'vitest'
import { API_METHODS, channelName, createApiClient } from './ipc-contract'

describe('createApiClient', () => {
  it('forwards each call to its channel with all arguments', async () => {
    const invoke = vi.fn(async () => 'result')
    const api = createApiClient(invoke)

    await expect(api.mail.listMessages('acc-1', 'inbox')).resolves.toBe('result')
    expect(invoke).toHaveBeenCalledWith('mail:listMessages', 'acc-1', 'inbox')

    await api.app.getInfo()
    expect(invoke).toHaveBeenLastCalledWith('app:getInfo')
  })

  it('exposes exactly the methods listed in API_METHODS', () => {
    const api = createApiClient(vi.fn())
    for (const [namespace, methods] of Object.entries(API_METHODS)) {
      expect(Object.keys(api[namespace as keyof typeof api]).sort()).toEqual([...methods].sort())
    }
  })
})

describe('channelName', () => {
  it('joins namespace and method', () => {
    expect(channelName('mail', 'getMessage')).toBe('mail:getMessage')
  })
})
