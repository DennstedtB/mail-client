import { describe, expect, it } from 'vitest'
import { describeConnectionError } from './describe-error'

// Error shapes as ImapFlow 2.10 and Nodemailer 10 report them against a real server (Stalwart 1.0).
const cases: [string, object, string][] = [
  [
    'IMAP wrong password',
    {
      message: 'Command failed',
      authenticationFailed: true,
      serverResponseCode: 'AUTHENTICATIONFAILED',
    },
    'auth',
  ],
  [
    'SMTP wrong password',
    { code: 'EAUTH', message: 'Invalid login: 535 5.7.8 Authentication credentials invalid.' },
    'auth',
  ],
  [
    'IMAP self-signed',
    { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' },
    'certificate',
  ],
  [
    'SMTP self-signed',
    { code: 'ESOCKET', message: 'self-signed certificate', command: 'CONN' },
    'certificate',
  ],
  [
    'IMAP refused',
    { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:9993' },
    'refused',
  ],
  ['SMTP refused', { code: 'ESOCKET', message: 'connect ECONNREFUSED 127.0.0.1:9465' }, 'refused'],
  [
    'IMAP unknown host',
    { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND no-such-host.invalid' },
    'host-not-found',
  ],
  [
    'SMTP unknown host',
    { code: 'EDNS', message: 'getaddrinfo ENOTFOUND no-such-host.invalid' },
    'host-not-found',
  ],
  [
    'IMAP STARTTLS on a TLS port',
    {
      code: 'GREETING_TIMEOUT',
      message: 'Failed to receive greeting from server in required time. Maybe should use TLS?',
    },
    'security-mismatch',
  ],
  [
    'SMTP STARTTLS on a TLS port',
    { code: 'ETIMEDOUT', message: 'Greeting never received', command: 'CONN' },
    'security-mismatch',
  ],
  [
    'IMAP TLS on a plain port',
    {
      code: 'ERR_SSL_WRONG_VERSION_NUMBER',
      message: 'SSL routines:tls_validate_record_header:wrong version number',
    },
    'security-mismatch',
  ],
  [
    'SMTP TLS on a plain port',
    { code: 'ESOCKET', message: 'SSL routines:tls_validate_record_header:wrong version number' },
    'security-mismatch',
  ],
  ['IMAP connect timeout', { code: 'CONNECT_TIMEOUT', message: 'Connection timed out' }, 'timeout'],
  ['SMTP connection timeout', { code: 'ETIMEDOUT', message: 'Connection timeout' }, 'timeout'],
]

describe('describeConnectionError', () => {
  it.each(cases)('%s → %s', (_label, error, problem) => {
    const result = describeConnectionError(error)
    expect(result.ok).toBe(false)
    expect(result.problem).toBe(problem)
    expect(result.message).not.toMatch(/undefined/)
  })

  it('keeps the raw message for problems it cannot classify', () => {
    const result = describeConnectionError(new Error('Something odd happened'))
    expect(result.problem).toBe('unknown')
    expect(result.message).toContain('Something odd happened')
  })

  it('copes with values that are not errors', () => {
    expect(describeConnectionError('boom').message).toContain('boom')
    expect(describeConnectionError(undefined).problem).toBe('unknown')
  })
})
