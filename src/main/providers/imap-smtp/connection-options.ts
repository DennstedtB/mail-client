import type { ImapFlowOptions } from 'imapflow'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { isLoopbackHost } from '@shared/account-validation'
import type { ImapSmtpSettings, ServerSettings } from '@shared/types/account'

/** Fail fast in the account dialog instead of waiting for library defaults (up to 90 s). */
export const TIMEOUTS = { connection: 15_000, greeting: 15_000, socket: 60_000 } as const

/**
 * TLS options for one server. A self-signed certificate is accepted only when
 * the account allows it AND the server is on this computer; for any other
 * host certificates are always verified, whatever the stored setting says.
 */
export function tlsOptions(server: ServerSettings, settings: ImapSmtpSettings) {
  const trustSelfSigned = settings.acceptSelfSignedLocalCertificate && isLoopbackHost(server.host)
  return {
    minVersion: 'TLSv1.2' as const,
    rejectUnauthorized: !trustSelfSigned,
    servername: isIpAddress(server.host) ? undefined : server.host,
  }
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

export function imapOptions(settings: ImapSmtpSettings, password: string): ImapFlowOptions {
  const { imap } = settings
  return {
    host: imap.host.trim(),
    port: imap.port,
    secure: imap.security === 'tls',
    // STARTTLS is required, never optional: credentials must not be sent in clear text.
    doSTARTTLS: imap.security === 'starttls' ? true : undefined,
    auth: { user: settings.username.trim(), pass: password },
    tls: tlsOptions(imap, settings),
    // ImapFlow logs to the console by default; nothing about accounts may end up in logs.
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: TIMEOUTS.connection,
    greetingTimeout: TIMEOUTS.greeting,
    socketTimeout: TIMEOUTS.socket,
  }
}

export function smtpOptions(settings: ImapSmtpSettings, password: string): SMTPTransport.Options {
  const { smtp } = settings
  return {
    host: smtp.host.trim(),
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    auth: { user: settings.username.trim(), pass: password },
    tls: tlsOptions(smtp, settings),
    logger: false,
    debug: false,
    connectionTimeout: TIMEOUTS.connection,
    greetingTimeout: TIMEOUTS.greeting,
    socketTimeout: TIMEOUTS.socket,
  }
}
