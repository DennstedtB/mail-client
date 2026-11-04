import addressparser from 'nodemailer/lib/addressparser'
import type { Address } from '@shared/types/mail'

/** Parses a typed recipient list. Returns the addresses, or the entries that aren't valid. */
export function parseRecipients(
  text: string,
): { ok: true; addresses: Address[] } | { ok: false; invalid: string[] } {
  if (!text.trim()) return { ok: true, addresses: [] }
  const parsed = addressparser(semicolonsToCommas(text), { flatten: true })
  const invalid: string[] = []
  const addresses: Address[] = []
  for (const entry of parsed) {
    const email = entry.address?.trim() ?? ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      invalid.push(entry.name || email || text.trim())
      continue
    }
    addresses.push({ ...(entry.name ? { name: entry.name } : {}), email })
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, addresses }
}

/** Outlook separates recipients with ";". Turns those into commas, but not inside quoted names. */
function semicolonsToCommas(text: string): string {
  let quoted = false
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\\' && quoted) {
      result += char + (text[i + 1] ?? '')
      i++
      continue
    }
    if (char === '"') quoted = !quoted
    result += char === ';' && !quoted ? ',' : char
  }
  return result
}

/** Formats addresses the way they are typed into a recipient field. */
export function formatRecipients(addresses: Address[]): string {
  return addresses
    .map((a) =>
      a.name
        ? `${/[,;<>"@]/.test(a.name) ? JSON.stringify(a.name) : a.name} <${a.email}>`
        : a.email,
    )
    .join(', ')
}

const REPLY_PREFIX = /^\s*((re|aw|sv|antw)\s*(\[\d+\])?\s*:\s*)+/i
const FORWARD_PREFIX = /^\s*((fwd?|wg|tr|vs)\s*:\s*)+/i

export function replySubject(subject: string): string {
  return `Re: ${subject.replace(REPLY_PREFIX, '').trim()}`
}

export function forwardSubject(subject: string): string {
  return `Fwd: ${subject.replace(FORWARD_PREFIX, '').replace(REPLY_PREFIX, '').trim()}`
}

function sameAddress(a: Address, b: Address) {
  return a.email.toLowerCase() === b.email.toLowerCase()
}

function unique(addresses: Address[]): Address[] {
  return addresses.filter((a, i) => addresses.findIndex((b) => sameAddress(a, b)) === i)
}

export interface ReplySource {
  from: Address
  replyTo: Address[]
  to: Address[]
  cc: Address[]
}

/**
 * Recipients of a reply. Reply goes to Reply-To (or From); reply all adds
 * everyone else from To and Cc, without the sender's own address.
 * Replying to one's own sent message goes to its original recipients.
 */
export function replyRecipients(
  source: ReplySource,
  self: string,
  all: boolean,
): { to: Address[]; cc: Address[] } {
  const me: Address = { email: self }
  const fromMe = sameAddress(source.from, me)
  const primary = fromMe ? source.to : source.replyTo.length > 0 ? source.replyTo : [source.from]
  const to = unique(primary)
  if (!all) return { to: to.length > 0 ? to : [source.from], cc: [] }
  const others = fromMe ? source.cc : [...source.to, ...source.cc]
  const cc = unique(others).filter((a) => !sameAddress(a, me) && !to.some((t) => sameAddress(t, a)))
  return { to, cc }
}

function displayAddress(a: Address) {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

/** Date in the quote line; the locale is the app's, so it reads like the dates in the window. */
function formatDate(iso: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

export function quoteForReply(
  text: string,
  from: Address,
  dateIso: string,
  locale?: string,
): string {
  const quoted = text
    .trimEnd()
    .split('\n')
    .map((line) => (line.startsWith('>') ? `>${line}` : `> ${line}`))
    .join('\n')
  return `\n\nOn ${formatDate(dateIso, locale)}, ${displayAddress(from)} wrote:\n${quoted}\n`
}

export function forwardBlock(
  text: string,
  source: { from: Address; to: Address[]; cc: Address[]; subject: string; date: string },
  locale?: string,
): string {
  const lines = [
    '',
    '',
    '---------- Forwarded message ----------',
    `From: ${displayAddress(source.from)}`,
    `Date: ${formatDate(source.date, locale)}`,
    `Subject: ${source.subject}`,
    `To: ${source.to.map(displayAddress).join(', ')}`,
    ...(source.cc.length > 0 ? [`Cc: ${source.cc.map(displayAddress).join(', ')}`] : []),
    '',
    text.trimEnd(),
    '',
  ]
  return lines.join('\n')
}

/** References header of a reply: the original's references plus its own Message-ID. */
export function replyReferences(references: string[], messageId: string | undefined): string[] {
  const all = messageId ? [...references, messageId] : references
  return all.filter((id, i) => all.indexOf(id) === i)
}
