import { describe, expect, it } from 'vitest'
import type { ImapSmtpSettings } from '@shared/types/account'
import { imapOptions, smtpOptions } from './connection-options'

const remote: ImapSmtpSettings = {
  imap: { host: 'imap.example.com', port: 993, security: 'tls' },
  smtp: { host: 'smtp.example.com', port: 587, security: 'starttls' },
  username: ' alice@example.com ',
  acceptSelfSignedLocalCertificate: false,
}

const local: ImapSmtpSettings = {
  imap: { host: '127.0.0.1', port: 1993, security: 'tls' },
  smtp: { host: 'localhost', port: 1465, security: 'tls' },
  username: 'alice@mailclient.test',
  acceptSelfSignedLocalCertificate: true,
}

describe('imapOptions', () => {
  it('uses TLS from the start for "tls"', () => {
    const options = imapOptions(remote, 'pw')
    expect(options.secure).toBe(true)
    expect(options.doSTARTTLS).toBeUndefined()
  })

  it('requires STARTTLS for "starttls"', () => {
    const options = imapOptions(
      { ...remote, imap: { ...remote.imap, port: 143, security: 'starttls' } },
      'pw',
    )
    expect(options.secure).toBe(false)
    expect(options.doSTARTTLS).toBe(true)
  })

  it('never logs, and trims the user name', () => {
    const options = imapOptions(remote, 'pw')
    expect(options.logger).toBe(false)
    expect(options.auth).toEqual({ user: 'alice@example.com', pass: 'pw' })
  })

  it('verifies certificates of remote servers', () => {
    expect(imapOptions(remote, 'pw').tls?.rejectUnauthorized).toBe(true)
    expect(imapOptions(remote, 'pw').tls?.servername).toBe('imap.example.com')
  })

  it('accepts a self-signed certificate only for a server on this computer', () => {
    expect(imapOptions(local, 'pw').tls?.rejectUnauthorized).toBe(false)
    expect(imapOptions(local, 'pw').tls?.servername).toBeUndefined()
  })

  it('ignores the self-signed setting for a remote host, even if it was stored', () => {
    const tampered = { ...remote, acceptSelfSignedLocalCertificate: true }
    expect(imapOptions(tampered, 'pw').tls?.rejectUnauthorized).toBe(true)
  })
})

describe('smtpOptions', () => {
  it('requires STARTTLS for "starttls"', () => {
    const options = smtpOptions(remote, 'pw')
    expect(options.secure).toBe(false)
    expect(options.requireTLS).toBe(true)
  })

  it('uses TLS from the start for "tls"', () => {
    const options = smtpOptions(local, 'pw')
    expect(options.secure).toBe(true)
    expect(options.requireTLS).toBe(false)
  })

  it('applies the same certificate rules as IMAP', () => {
    expect(smtpOptions(remote, 'pw').tls?.rejectUnauthorized).toBe(true)
    expect(smtpOptions(local, 'pw').tls?.rejectUnauthorized).toBe(false)
  })
})
