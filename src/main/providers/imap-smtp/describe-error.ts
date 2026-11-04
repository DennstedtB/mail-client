import type { CheckProblem, CheckResult } from '@shared/types/account'

const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

interface ErrorLike {
  code?: unknown
  message?: unknown
  authenticationFailed?: unknown
}

const MESSAGES: Record<Exclude<CheckProblem, 'unknown'>, string> = {
  auth: 'The server rejected the user name or password.',
  certificate:
    "The server's certificate isn't trusted. Check the server name; for a server on this Mac with a self-signed certificate, allow it below.",
  'host-not-found': "The server name couldn't be found. Check the spelling.",
  refused: 'The server refused the connection. Check the port, and that the server is running.',
  'security-mismatch':
    "The connection security doesn't match the port. Ports 993 and 465 use TLS; ports 143 and 587 use STARTTLS.",
  timeout:
    "The server didn't answer in time. Check the port and the connection security, and your network.",
}

function classify(error: ErrorLike, text: string): CheckProblem {
  const code = typeof error.code === 'string' ? error.code : ''
  if (error.authenticationFailed === true || code === 'EAUTH') return 'auth'
  if (CERTIFICATE_CODES.has(code) || /certificate|altnames/i.test(text)) return 'certificate'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS' || /ENOTFOUND/.test(text)) {
    return 'host-not-found'
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(text)) return 'refused'
  if (code === 'ERR_SSL_WRONG_VERSION_NUMBER' || /wrong version number|STARTTLS/i.test(text)) {
    return 'security-mismatch'
  }
  // A missing greeting usually means TLS was expected from the first byte.
  if (code === 'GREETING_TIMEOUT' || /greeting/i.test(text)) return 'security-mismatch'
  if (code === 'CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === 'ETIMEOUT') return 'timeout'
  return 'unknown'
}

/**
 * Turns an ImapFlow or Nodemailer error into a result the account dialog can
 * show. The raw message is only used for problems we can't classify.
 */
export function describeConnectionError(error: unknown): Extract<CheckResult, { ok: false }> {
  const e: ErrorLike = typeof error === 'object' && error !== null ? error : {}
  const text = typeof e.message === 'string' ? e.message : String(error)
  const problem = classify(e, text)
  const message = problem === 'unknown' ? `The connection failed: ${text}` : MESSAGES[problem]
  return { ok: false, problem, message }
}
