import { createServer, type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SMTPServer } from 'smtp-server'
import type { ImapSmtpSettings } from '@shared/types/account'
import { checkSmtp } from './check-connection'

// Integration test against a real SMTP server in this process, with smtp-server's
// built-in self-signed certificate: covers the TLS, certificate and sign-in paths.

const USER = 'alice@mailclient.test'
const PASSWORD = 'correct-password'

let server: SMTPServer
let port = 0

beforeAll(async () => {
  server = new SMTPServer({
    secure: true,
    logger: false,
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, _session, callback) {
      if (auth.username === USER && auth.password === PASSWORD) callback(null, { user: USER })
      else callback(new Error('Invalid username or password'))
    },
  })
  // The client drops the connection when it rejects the certificate; that's expected here.
  server.on('error', () => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

function settings(overrides: Partial<ImapSmtpSettings> = {}): ImapSmtpSettings {
  return {
    imap: { host: '127.0.0.1', port: 1, security: 'tls' },
    smtp: { host: '127.0.0.1', port, security: 'tls' },
    username: USER,
    acceptSelfSignedLocalCertificate: true,
    ...overrides,
  }
}

async function closedPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port: free } = probe.address() as AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return free
}

describe('checkSmtp against a local server', () => {
  it('succeeds with the right password and an allowed self-signed certificate', async () => {
    await expect(checkSmtp(settings(), PASSWORD)).resolves.toEqual({ ok: true })
  })

  it('reports the certificate when self-signed certificates are not allowed', async () => {
    const result = await checkSmtp(settings({ acceptSelfSignedLocalCertificate: false }), PASSWORD)
    expect(result).toMatchObject({ ok: false, problem: 'certificate' })
  })

  it('reports a rejected password', async () => {
    const result = await checkSmtp(settings(), 'wrong-password')
    expect(result).toMatchObject({ ok: false, problem: 'auth' })
  })

  it('reports a refused connection', async () => {
    const free = await closedPort()
    const result = await checkSmtp(
      settings({ smtp: { host: '127.0.0.1', port: free, security: 'tls' } }),
      PASSWORD,
    )
    expect(result).toMatchObject({ ok: false, problem: 'refused' })
  })
})
