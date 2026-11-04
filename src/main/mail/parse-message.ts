import { simpleParser, type AddressObject, type Attachment as ParsedAttachment } from 'mailparser'
import type { Address, Attachment } from '@shared/types/mail'
import { makePreview } from './message-ref'

/** What the cache keeps of a downloaded message. */
export interface ParsedMessage {
  text: string
  /** With cid: images already turned into data: URLs by mailparser. */
  html?: string
  attachments: Attachment[]
  preview: string
  messageId?: string
  inReplyTo?: string
  references: string[]
  replyTo: Address[]
  to: Address[]
  cc: Address[]
}

export interface AttachmentContent {
  filename: string
  mimeType: string
  content: Buffer
}

/** Inline images that the HTML already shows are not listed as attachments. */
function isVisibleAttachment(attachment: ParsedAttachment): boolean {
  return !(attachment.related && attachment.contentType.startsWith('image/'))
}

function fallbackName(attachment: ParsedAttachment, index: number): string {
  const extension = attachment.contentType.split('/')[1]?.split(/[;+]/)[0] ?? 'bin'
  return `attachment-${index + 1}.${extension}`
}

function addresses(value: AddressObject | AddressObject[] | undefined): Address[] {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list
    .flatMap((group) => group.value)
    .filter((a) => a.address)
    .map((a) => ({ ...(a.name ? { name: a.name } : {}), email: a.address! }))
}

/** Parses a raw RFC 822 message into text, HTML and attachment metadata. */
export async function parseMessage(source: Buffer): Promise<ParsedMessage> {
  const parsed = await simpleParser(source, { skipTextToHtml: true })
  const text = (parsed.text ?? '').trim()
  const attachments: Attachment[] = []
  parsed.attachments.forEach((attachment, index) => {
    if (!isVisibleAttachment(attachment)) return
    attachments.push({
      // The index in mailparser's list is stable for the same source.
      id: String(index),
      filename: attachment.filename || fallbackName(attachment, index),
      mimeType: attachment.contentType,
      size: attachment.size,
    })
  })
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? parsed.references.split(/\s+/).filter(Boolean)
      : []
  return {
    text,
    html: parsed.html || undefined,
    attachments,
    preview: makePreview(text),
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references,
    replyTo: addresses(parsed.replyTo),
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
  }
}

/** Extracts one attachment, identified by the id parseMessage gave it. */
export async function extractAttachment(
  source: Buffer,
  attachmentId: string,
): Promise<AttachmentContent> {
  const parsed = await simpleParser(source, { skipTextToHtml: true, keepCidLinks: true })
  const index = Number(attachmentId)
  const attachment = Number.isInteger(index) ? parsed.attachments[index] : undefined
  if (!attachment) throw new Error('This attachment no longer exists.')
  return {
    filename: attachment.filename || fallbackName(attachment, index),
    mimeType: attachment.contentType,
    content: attachment.content,
  }
}
