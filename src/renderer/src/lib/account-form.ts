import { DEFAULT_PORTS, type ConnectionSecurity, type NewAccountInput } from '@shared/types/account'

/** What the "Add account" form edits. Ports are strings while the user types. */
export interface AccountForm {
  name: string
  senderName: string
  email: string
  password: string
  /** Empty means "same as the email address". */
  username: string
  imapHost: string
  imapPort: string
  imapSecurity: ConnectionSecurity
  smtpHost: string
  smtpPort: string
  smtpSecurity: ConnectionSecurity
  acceptSelfSignedLocalCertificate: boolean
}

export const EMPTY_FORM: AccountForm = {
  name: '',
  senderName: '',
  email: '',
  password: '',
  username: '',
  imapHost: '',
  imapPort: String(DEFAULT_PORTS.imap.tls),
  imapSecurity: 'tls',
  smtpHost: '',
  smtpPort: String(DEFAULT_PORTS.smtp.tls),
  smtpSecurity: 'tls',
  acceptSelfSignedLocalCertificate: false,
}

/** The local Stalwart test server from docs/dev-mail-server.md. The password is typed by hand. */
export const LOCAL_TEST_SERVER: Omit<AccountForm, 'password'> = {
  name: 'Local test server',
  senderName: 'Alice Test',
  email: 'alice@mailclient.test',
  username: '',
  imapHost: '127.0.0.1',
  imapPort: '1993',
  imapSecurity: 'tls',
  smtpHost: '127.0.0.1',
  smtpPort: '1465',
  smtpSecurity: 'tls',
  acceptSelfSignedLocalCertificate: true,
}

export function toAccountInput(form: AccountForm): NewAccountInput {
  const port = (value: string) => (value.trim() === '' ? Number.NaN : Number(value))
  return {
    name: form.name,
    senderName: form.senderName,
    email: form.email.trim(),
    password: form.password,
    settings: {
      imap: { host: form.imapHost.trim(), port: port(form.imapPort), security: form.imapSecurity },
      smtp: { host: form.smtpHost.trim(), port: port(form.smtpPort), security: form.smtpSecurity },
      username: form.username.trim() || form.email.trim(),
      acceptSelfSignedLocalCertificate: form.acceptSelfSignedLocalCertificate,
    },
  }
}

/**
 * Port to use after the security mode changes: a standard port follows the
 * mode (993 ↔ 143, 465 ↔ 587); a custom port is left alone.
 */
export function portForSecurity(
  protocol: 'imap' | 'smtp',
  currentPort: string,
  next: ConnectionSecurity,
): string {
  const defaults = DEFAULT_PORTS[protocol]
  const isStandard =
    currentPort === String(defaults.tls) || currentPort === String(defaults.starttls)
  return isStandard ? String(defaults[next]) : currentPort
}

/** Server name suggestions from the email domain, used as placeholders only. */
export function suggestedHosts(email: string): { imap: string; smtp: string } {
  const domain = email.split('@')[1]?.trim()
  if (!domain || !domain.includes('.'))
    return { imap: 'imap.example.com', smtp: 'smtp.example.com' }
  return { imap: `imap.${domain}`, smtp: `smtp.${domain}` }
}
