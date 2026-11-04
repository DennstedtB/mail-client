import nodemailer from 'nodemailer'
import { afterAll, describe, expect, it } from 'vitest'
import type { ImapSmtpSettings } from '@shared/types/account'
import { MailCache } from '../../cache/mail-cache'
import { connectionChecker } from './check-connection'
import { smtpOptions } from './connection-options'
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

  describe('reading mail', () => {
    const account = {
      id: 'live-read',
      name: 'Live',
      email: user,
      senderName: 'Live',
      kind: 'imap' as const,
    }
    const provider = new ImapSmtpMailProvider(account, settings, async () => password!)
    const cache = new MailCache(':memory:')
    afterAll(async () => {
      await provider.close()
      cache.close()
    })

    async function sendToSelf(subject: string) {
      const transport = nodemailer.createTransport(smtpOptions(settings, password!))
      await transport.sendMail({ from: user, to: user, subject, text: `Body of ${subject}` })
      transport.close()
    }

    it('syncs new mail into the cache and downloads it without marking it read', async () => {
      const subject = `Live sync ${Date.now()}`
      await sendToSelf(subject)
      await expect
        .poll(
          async () => {
            await provider.syncFolder('INBOX', cache)
            return cache.listMessages(account.id, 'INBOX').some((m) => m.subject === subject)
          },
          { timeout: 15_000, interval: 1000 },
        )
        .toBe(true)

      const row = cache.listMessages(account.id, 'INBOX').find((m) => m.subject === subject)!
      expect(row.seen).toBe(false)
      const message = await provider.fetchMessage({ folderId: 'INBOX', uid: row.uid })
      expect(message.text).toBe(`Body of ${subject}`)

      await provider.syncFolder('INBOX', cache)
      expect(cache.getMessage(account.id, 'INBOX', row.uid)?.seen).toBe(false)
    }, 30_000)

    it('reports new mail through IMAP IDLE', async () => {
      const changes: string[] = []
      const stop = provider.watch((folder) => changes.push(folder))
      // Let the watcher connect and settle (it reports once after connecting).
      await new Promise((resolve) => setTimeout(resolve, 2500))
      changes.length = 0
      await sendToSelf(`Live idle ${Date.now()}`)
      await expect
        .poll(() => changes.includes('INBOX'), { timeout: 15_000, interval: 250 })
        .toBe(true)
      stop()
    }, 30_000)

    it('sends, files one copy in Sent, and changes flags', async () => {
      const subject = `Live send ${Date.now()}`
      const messageId = `<live-${Date.now()}@mailclient.test>`
      const raw = Buffer.from(
        `From: ${user}\r\nTo: ${user}\r\nSubject: ${subject}\r\nMessage-ID: ${messageId}\r\n\r\nHello\r\n`,
      )
      const copy = await provider.send({
        envelope: { from: user, to: [user] },
        raw,
        sentCopy: raw,
        messageId,
      })
      expect(copy).toMatchObject({ saved: true })
      const sentFolder = copy.saved ? copy.folderId : ''
      await provider.syncFolder(sentFolder, cache)
      const inSent = cache.listMessages(account.id, sentFolder).filter((m) => m.subject === subject)
      expect(inSent).toHaveLength(1)
      expect(inSent[0]?.seen).toBe(true)

      await provider.setFlags(sentFolder, [inSent[0]!.uid], { seen: false, flagged: true })
      await provider.syncFolder(sentFolder, cache)
      expect(cache.getMessage(account.id, sentFolder, inSent[0]!.uid)).toMatchObject({
        seen: false,
        flagged: true,
      })
    }, 30_000)

    it('moves a message to the trash and deletes it there', async () => {
      const subject = `Live move ${Date.now()}`
      await sendToSelf(subject)
      const find = (folder: string) =>
        cache.listMessages(account.id, folder).find((m) => m.subject === subject)
      await expect
        .poll(
          async () => {
            await provider.syncFolder('INBOX', cache)
            return find('INBOX') !== undefined
          },
          { timeout: 15_000, interval: 1000 },
        )
        .toBe(true)
      const trash = (await provider.listFolders()).find((f) => f.role === 'trash')!.id

      await provider.moveMessages('INBOX', [find('INBOX')!.uid], trash)
      await provider.syncFolder('INBOX', cache)
      await provider.syncFolder(trash, cache)
      expect(find('INBOX')).toBeUndefined()
      expect(find(trash)).toBeDefined()

      await provider.deleteMessages(trash, [find(trash)!.uid])
      await provider.syncFolder(trash, cache)
      expect(find(trash)).toBeUndefined()
    }, 30_000)
  })
})
