import { describe, expect, it } from 'vitest'
import { hasErrors, isLoopbackHost, validateNewAccount } from './account-validation'
import type { NewAccountInput } from './types/account'

function input(overrides: Partial<NewAccountInput> = {}): NewAccountInput {
  return {
    name: 'Work',
    senderName: 'Alice Test',
    email: 'alice@example.com',
    password: 'secret',
    settings: {
      imap: { host: 'imap.example.com', port: 993, security: 'tls' },
      smtp: { host: 'smtp.example.com', port: 465, security: 'tls' },
      username: 'alice@example.com',
      acceptSelfSignedLocalCertificate: false,
    },
    ...overrides,
  }
}

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', 'localhost.', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])(
    'accepts %s',
    (host) => expect(isLoopbackHost(host)).toBe(true),
  )

  it.each([
    '',
    'example.com',
    'localhost.example.com',
    '128.0.0.1',
    '127.0.0.256',
    '10.0.0.1',
    '127.0.0',
  ])('rejects %s', (host) => expect(isLoopbackHost(host)).toBe(false))
})

describe('validateNewAccount', () => {
  it('accepts a complete account', () => {
    expect(validateNewAccount(input())).toEqual({})
    expect(hasErrors(validateNewAccount(input()))).toBe(false)
  })

  it('requires name, sender name, email, password and user name', () => {
    const errors = validateNewAccount(
      input({
        name: ' ',
        senderName: '',
        email: 'not-an-address',
        password: '',
        settings: { ...input().settings, username: ' ' },
      }),
    )
    expect(Object.keys(errors).sort()).toEqual([
      'email',
      'name',
      'password',
      'senderName',
      'username',
    ])
  })

  it('rejects hosts with a scheme, port or spaces', () => {
    for (const host of [
      'https://mail.example.com',
      'mail.example.com:993',
      'mail example.com',
      '',
    ]) {
      const errors = validateNewAccount(
        input({ settings: { ...input().settings, imap: { host, port: 993, security: 'tls' } } }),
      )
      expect(errors['imap.host'], host).toBeDefined()
    }
  })

  it('rejects ports outside 1–65535', () => {
    for (const port of [0, 65536, 99.5, Number.NaN]) {
      const errors = validateNewAccount(
        input({
          settings: {
            ...input().settings,
            smtp: { host: 'smtp.example.com', port, security: 'tls' },
          },
        }),
      )
      expect(errors['smtp.port'], String(port)).toBeDefined()
    }
  })

  it('allows self-signed certificates only when both servers are on this computer', () => {
    const remote = input({
      settings: { ...input().settings, acceptSelfSignedLocalCertificate: true },
    })
    expect(validateNewAccount(remote).acceptSelfSignedLocalCertificate).toBeDefined()

    const local = input({
      settings: {
        imap: { host: '127.0.0.1', port: 1993, security: 'tls' },
        smtp: { host: 'localhost', port: 1465, security: 'tls' },
        username: 'alice@mailclient.test',
        acceptSelfSignedLocalCertificate: true,
      },
    })
    expect(validateNewAccount(local)).toEqual({})
  })
})
