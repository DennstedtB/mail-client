import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import type { CheckResult, ImapSmtpSettings } from '@shared/types/account'
import { imapOptions, smtpOptions } from './connection-options'
import { describeConnectionError } from './describe-error'

/** Signs in to the IMAP server and signs out again. */
export async function checkImap(
  settings: ImapSmtpSettings,
  password: string,
): Promise<CheckResult> {
  const client = new ImapFlow({ ...imapOptions(settings, password), verifyOnly: true })
  // Without a listener, a late socket error would crash the main process.
  client.on('error', () => {})
  try {
    await client.connect()
    return { ok: true }
  } catch (error) {
    return describeConnectionError(error)
  } finally {
    client.close()
  }
}

/** Connects to the SMTP server and signs in, without sending anything. */
export async function checkSmtp(
  settings: ImapSmtpSettings,
  password: string,
): Promise<CheckResult> {
  const transport = nodemailer.createTransport(smtpOptions(settings, password))
  try {
    await transport.verify()
    return { ok: true }
  } catch (error) {
    return describeConnectionError(error)
  } finally {
    transport.close()
  }
}

export interface ConnectionChecker {
  check(
    settings: ImapSmtpSettings,
    password: string,
  ): Promise<{ imap: CheckResult; smtp: CheckResult }>
}

/** Checks both servers at the same time. */
export const connectionChecker: ConnectionChecker = {
  async check(settings, password) {
    const [imap, smtp] = await Promise.all([
      checkImap(settings, password),
      checkSmtp(settings, password),
    ])
    return { imap, smtp }
  },
}
