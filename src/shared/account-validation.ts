/**
 * Validation for the "Add account" form. Runs in the UI for immediate
 * feedback and again in the main process, which never trusts its input.
 * Pure functions, no dependencies.
 */

import type { NewAccountInput, ServerSettings } from './types/account'

export type AccountField =
  | 'name'
  | 'senderName'
  | 'email'
  | 'password'
  | 'username'
  | 'imap.host'
  | 'imap.port'
  | 'smtp.host'
  | 'smtp.port'
  | 'acceptSelfSignedLocalCertificate'

export type ValidationErrors = Partial<Record<AccountField, string>>

// Deliberately simple: one @, something on both sides, a dot in the domain, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Host names and IPv4 addresses; no scheme, path, port or spaces.
const HOST =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/
const IPV6_LOOPBACK = /^(\[::1\]|::1)$/

/** True for servers on this computer: localhost, 127.0.0.0/8 and ::1. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || IPV6_LOOPBACK.test(h)) return true
  const parts = h.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  )
}

function validateServer(
  server: ServerSettings,
  prefix: 'imap' | 'smtp',
  errors: ValidationErrors,
): void {
  const label = prefix === 'imap' ? 'incoming' : 'outgoing'
  const host = server.host.trim()
  if (!host) errors[`${prefix}.host`] = `Enter the ${label} mail server.`
  else if (!HOST.test(host) && !IPV6_LOOPBACK.test(host)) {
    errors[`${prefix}.host`] =
      'Enter a server name like mail.example.com, without https:// or a port.'
  }
  if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) {
    errors[`${prefix}.port`] = 'Enter a port between 1 and 65535.'
  }
}

export function validateNewAccount(input: NewAccountInput): ValidationErrors {
  const errors: ValidationErrors = {}
  if (!input.name.trim()) errors.name = 'Enter a name for this account, for example "Work".'
  if (!input.senderName.trim()) errors.senderName = 'Enter the name recipients should see.'
  if (!EMAIL.test(input.email.trim())) errors.email = 'Enter a valid email address.'
  if (!input.password) errors.password = 'Enter the password.'
  if (!input.settings.username.trim()) errors.username = 'Enter the user name.'
  validateServer(input.settings.imap, 'imap', errors)
  validateServer(input.settings.smtp, 'smtp', errors)
  if (
    input.settings.acceptSelfSignedLocalCertificate &&
    !(isLoopbackHost(input.settings.imap.host) && isLoopbackHost(input.settings.smtp.host))
  ) {
    errors.acceptSelfSignedLocalCertificate =
      'Self-signed certificates are only accepted for servers on this Mac.'
  }
  return errors
}

export function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0
}
