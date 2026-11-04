import { describeConnectionError } from './describe-error'

interface SmtpErrorLike {
  code?: unknown
  responseCode?: unknown
  response?: unknown
  rejected?: unknown
  message?: unknown
}

const CONNECTION_CODES = new Set(['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS'])

/**
 * Turns a Nodemailer error into a message that says the mail was not sent,
 * and why. Server responses are kept, because they often name the problem
 * (e.g. "mailbox unavailable").
 */
export function describeSendError(error: unknown): Error {
  const e: SmtpErrorLike = typeof error === 'object' && error !== null ? error : {}
  const code = typeof e.code === 'string' ? e.code : ''
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : 0
  const response = typeof e.response === 'string' ? e.response.trim() : ''
  const rejected = Array.isArray(e.rejected) ? e.rejected.filter((r) => typeof r === 'string') : []

  let message: string
  if (code === 'EENVELOPE' && rejected.length > 0) {
    message = `The server didn't accept ${rejected.length === 1 ? 'this recipient' : 'these recipients'}: ${rejected.join(', ')}.`
  } else if (responseCode === 552 || /size|too large|too big/i.test(response)) {
    message = 'The message is larger than the server accepts. Remove attachments and try again.'
  } else if (CONNECTION_CODES.has(code) || (!response && code)) {
    message = describeConnectionError(error).message
  } else {
    message = response || (typeof e.message === 'string' ? e.message : String(error))
  }
  return new Error(`The message wasn't sent. ${message}`, { cause: error })
}
