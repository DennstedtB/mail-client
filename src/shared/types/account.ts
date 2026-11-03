/**
 * Account setup types shared by UI and main process. JSON-serializable only.
 */

import type { Account } from './mail'

/**
 * How the connection is encrypted. There is deliberately no unencrypted
 * option: passwords never cross the network in clear text.
 * - `tls`: TLS from the first byte (IMAP 993, SMTP 465)
 * - `starttls`: plain connection upgraded with STARTTLS, which is required (IMAP 143, SMTP 587)
 */
export type ConnectionSecurity = 'tls' | 'starttls'

export interface ServerSettings {
  host: string
  port: number
  security: ConnectionSecurity
}

export interface ImapSmtpSettings {
  imap: ServerSettings
  smtp: ServerSettings
  /** User name for both servers; usually the email address. */
  username: string
  /**
   * Accept a self-signed certificate. Only honoured for servers on this
   * computer (localhost), such as the local test server.
   */
  acceptSelfSignedLocalCertificate: boolean
}

/** What the "Add account" form sends. The password goes to the Keychain and never comes back. */
export interface NewAccountInput {
  /** Label in the sidebar, e.g. "Work". */
  name: string
  /** Name shown to recipients in the From line. */
  senderName: string
  email: string
  password: string
  settings: ImapSmtpSettings
}

/** Why a connection check failed, so the UI can point at the right field. */
export type CheckProblem =
  | 'auth'
  | 'certificate'
  | 'host-not-found'
  | 'refused'
  | 'security-mismatch'
  | 'timeout'
  | 'unknown'

export type CheckResult = { ok: true } | { ok: false; problem: CheckProblem; message: string }

export type AddAccountResult =
  { status: 'added'; account: Account } | { status: 'failed'; imap: CheckResult; smtp: CheckResult }

/** Standard ports per protocol and security mode. */
export const DEFAULT_PORTS = {
  imap: { tls: 993, starttls: 143 },
  smtp: { tls: 465, starttls: 587 },
} as const satisfies Record<'imap' | 'smtp', Record<ConnectionSecurity, number>>
