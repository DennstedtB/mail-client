import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import type { Address } from '@shared/types/mail'

export interface OutgoingAttachment {
  filename: string
  content: Buffer
  contentType?: string
}

export interface MessageInput {
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  text: string
  attachments: OutgoingAttachment[]
  inReplyTo?: string
  references?: string[]
  date: Date
  messageId: string
}

/** A new Message-ID on the sender's domain, e.g. `<…uuid…@example.org>`. */
export function newMessageId(senderEmail: string): string {
  const domain = senderEmail.split('@')[1]?.trim() || 'mailclient.invalid'
  return `<${randomUUID()}@${domain}>`
}

const toMailbox = (a: Address) => (a.name ? { name: a.name, address: a.email } : a.email)

async function compile(input: MessageInput, keepBcc: boolean): Promise<Buffer> {
  const node = new MailComposer({
    from: toMailbox(input.from),
    to: input.to.map(toMailbox),
    cc: input.cc.map(toMailbox),
    bcc: input.bcc.map(toMailbox),
    subject: input.subject,
    text: input.text,
    attachments: input.attachments.map((a) => ({ ...a })),
    inReplyTo: input.inReplyTo,
    references: input.references,
    date: input.date,
    messageId: input.messageId,
  }).compile()
  node.keepBcc = keepBcc
  return node.build()
}

/**
 * Builds the message twice with the same Message-ID and date: once for the
 * recipients (Bcc header removed, as SMTP requires) and once for the Sent
 * folder (Bcc kept, so the sender can see who got a blind copy).
 */
export async function buildMessage(
  input: MessageInput,
): Promise<{ raw: Buffer; sentCopy: Buffer }> {
  const [raw, sentCopy] = await Promise.all([compile(input, false), compile(input, true)])
  return { raw, sentCopy }
}
