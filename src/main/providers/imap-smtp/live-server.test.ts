import { describe, expect, it } from 'vitest'
import type { ImapSmtpSettings } from '@shared/types/account'
import { connectionChecker } from './check-connection'
import { ImapSmtpMailProvider } from './imap-smtp-mail-provider'

/**
 * Runs against the local Stalwart test server (docs/dev-mail-server.md).
 * Skipped unless MAILCLIENT_LIVE_PASSWORD is set, e.g.:
 *
 *   MAILCLIENT_LIVE_PASSWORD=… npx vitest run live-server
 *
 * Optional: MAILCLIENT_LIVE_USER (default alice@mailclient.test),
 * MAILCLIENT_LIVE_IMAP_PORT (1993) and MAILCLIENT_LIVE_SMTP_PORT (1465).
 */
const password = process.env['MAILCLIENT_LIVE_PASSWORD']
const user = process.env['MAILCLIENT_LIVE_USER'] ?? 'alice@mailclient.test'

const settings: ImapSmtpSettings = {
  imap: {
    host: '127.0.0.1',
    port: Number(process.env['MAILCLIENT_LIVE_IMAP_PORT'] ?? 1993),
    security: 'tls',
  },
  smtp: {
    host: '127.0.0.1',
    port: Number(process.env['MAILCLIENT_LIVE_SMTP_PORT'] ?? 1465),
    security: 'tls',
  },
  username: user,
  acceptSelfSignedLocalCertificate: true,
}

describe.runIf(password)('local test server', () => {
  it('accepts the account on IMAP and SMTP', async () => {
    await expect(connectionChecker.check(settings, password!)).resolves.toEqual({
      imap: { ok: true },
      smtp: { ok: true },
    })
  })

  it('rejects a wrong password on both servers', async () => {
    const result = await connectionChecker.check(settings, 'definitely-wrong')
    expect(result.imap).toMatchObject({ ok: false, problem: 'auth' })
    expect(result.smtp).toMatchObject({ ok: false, problem: 'auth' })
  }, 20_000)

  it('lists the folders with an inbox first', async () => {
    const account = {
      id: 'live',
      name: 'Live',
      email: user,
      senderName: 'Live',
      kind: 'imap' as const,
    }
    const provider = new ImapSmtpMailProvider(account, settings, async () => password!)
    const folders = await provider.listFolders()
    expect(folders[0]).toMatchObject({ role: 'inbox', name: 'Inbox' })
    expect(folders.map((f) => f.role)).toEqual(expect.arrayContaining(['sent', 'drafts', 'trash']))
  })
})
