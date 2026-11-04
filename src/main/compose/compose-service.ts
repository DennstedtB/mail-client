import { basename } from 'node:path'
import type { ComposeApi } from '@shared/ipc-contract'
import type {
  ComposeKind,
  Draft,
  DraftAttachment,
  DraftField,
  SendResult,
} from '@shared/types/compose'
import type { AccountId, Address, MessageId } from '@shared/types/mail'
import type { MailProviderSource } from '../accounts/account-service'
import { decodeMessageId } from '../mail/message-ref'
import type { MailService } from '../services/mail-service'
import { buildMessage, newMessageId, type OutgoingAttachment } from './build-message'
import { DraftAttachments } from './draft-attachments'
import {
  forwardBlock,
  forwardSubject,
  formatRecipients,
  parseRecipients,
  quoteForReply,
  replyRecipients,
  replyReferences,
  replySubject,
} from './drafts'

/** Most providers accept 25 MB or more per message; attachments grow by a third when encoded. */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024

export interface ComposeServiceDeps {
  source: MailProviderSource
  mail: Pick<MailService, 'loadMessage' | 'setFlags' | 'syncFolder'>
  /** Shows the system file dialog; returns the picked paths, or [] if cancelled. */
  pickFiles(): Promise<string[]>
  /** Size of a regular file, or null for anything else (folders, missing files). */
  fileSize(path: string): Promise<number | null>
  /** Reads a file, but never more than maxBytes + 1 bytes (enough to see it's too big). */
  readFile(path: string, maxBytes: number): Promise<Buffer>
  /** Locale for dates in quote lines, the same the UI uses. */
  locale?: string
  now?: () => Date
}

function formatSize(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/** Implements the compose part of the IPC contract. */
export class ComposeService implements ComposeApi {
  private readonly attachments = new DraftAttachments()

  constructor(private readonly deps: ComposeServiceDeps) {}

  async prepare(
    kind: ComposeKind,
    accountId: AccountId,
    sourceMessageId?: MessageId,
  ): Promise<Draft> {
    const provider = await this.deps.source.provider(accountId)
    const draft: Draft = {
      kind,
      accountId,
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      body: '',
      attachments: [],
    }
    if (kind === 'new') return draft
    if (!sourceMessageId) throw new Error('No message to reply to or forward.')
    const loaded = await this.deps.mail.loadMessage(accountId, sourceMessageId)
    if (!loaded) throw new Error('This message no longer exists.')
    const { row, body } = loaded
    const to = body.to.length > 0 ? body.to : row.to
    const cc = body.cc.length > 0 ? body.cc : row.cc
    draft.sourceMessageId = sourceMessageId

    if (kind === 'forward') {
      draft.subject = forwardSubject(row.subject)
      draft.body = forwardBlock(
        body.text,
        {
          from: row.from,
          to,
          cc,
          subject: row.subject,
          date: row.date,
        },
        this.deps.locale,
      )
      draft.attachments = body.attachments.map((a) =>
        this.attachments.add(a.filename, a.size, {
          kind: 'forwarded',
          accountId,
          messageId: sourceMessageId,
          attachmentId: a.id,
        }),
      )
      return draft
    }

    const recipients = replyRecipients(
      { from: row.from, replyTo: body.headers.replyTo ?? [], to, cc },
      provider.account.email,
      kind === 'replyAll',
    )
    draft.to = formatRecipients(recipients.to)
    draft.cc = formatRecipients(recipients.cc)
    draft.subject = replySubject(row.subject)
    draft.body = quoteForReply(body.text, row.from, row.date, this.deps.locale)
    return draft
  }

  async addAttachments(): Promise<DraftAttachment[]> {
    const added: DraftAttachment[] = []
    for (const path of await this.deps.pickFiles()) {
      const size = await this.deps.fileSize(path)
      if (size === null) continue
      added.push(this.attachments.add(basename(path), size, { kind: 'file', path }))
    }
    return added
  }

  async releaseAttachments(ids: string[]) {
    this.attachments.release(ids)
  }

  async send(draft: Draft): Promise<SendResult> {
    const provider = await this.deps.source.provider(draft.accountId)
    const account = provider.account

    const fields: Record<DraftField, Address[]> = { to: [], cc: [], bcc: [] }
    for (const field of ['to', 'cc', 'bcc'] as const) {
      const parsed = parseRecipients(draft[field])
      if (!parsed.ok) {
        const [first] = parsed.invalid
        return { status: 'invalid', field, message: `"${first}" isn't an email address.` }
      }
      fields[field] = parsed.addresses
    }
    const everyone = [...fields.to, ...fields.cc, ...fields.bcc]
    if (everyone.length === 0) {
      return { status: 'invalid', field: 'to', message: 'Add at least one recipient.' }
    }

    // Attachments are resolved here, from what the main process handed out.
    const entries = this.attachments.resolve(draft.attachments.map((a) => a.id))
    if (!entries)
      throw new Error('An attachment is no longer available. Remove it and add it again.')
    const tooBig = (total: number) =>
      new Error(
        `The attachments add up to ${formatSize(total)}; the limit is ${formatSize(MAX_ATTACHMENT_BYTES)}, because most mail servers accept about 25 MB per message.`,
      )
    const listed = entries.reduce((sum, e) => sum + e.attachment.size, 0)
    if (listed > MAX_ATTACHMENT_BYTES) throw tooBig(listed)
    const attachments: OutgoingAttachment[] = []
    let total = 0
    for (const { attachment, source } of entries) {
      if (source.kind === 'file') {
        // Files can grow after they were picked; read no more than the limit allows.
        const remaining = MAX_ATTACHMENT_BYTES - total
        const content = await this.deps.readFile(source.path, remaining).catch(() => {
          throw new Error(
            `"${attachment.filename}" can't be read anymore. Remove it and add it again.`,
          )
        })
        total += content.length
        if (total > MAX_ATTACHMENT_BYTES) throw tooBig(total)
        attachments.push({ filename: attachment.filename, content })
      } else {
        const sourceProvider = await this.deps.source.provider(source.accountId)
        const content = await sourceProvider.fetchAttachment(
          decodeMessageId(source.messageId),
          source.attachmentId,
        )
        total += content.content.length
        if (total > MAX_ATTACHMENT_BYTES) throw tooBig(total)
        attachments.push({
          filename: attachment.filename,
          content: content.content,
          contentType: content.mimeType,
        })
      }
    }

    const isReply = draft.kind === 'reply' || draft.kind === 'replyAll'
    let threading: { inReplyTo?: string; references?: string[] } = {}
    if (isReply && draft.sourceMessageId) {
      const source = await this.deps.mail
        .loadMessage(draft.accountId, draft.sourceMessageId)
        .catch(() => null)
      const headers = source?.body.headers
      if (headers?.messageId) {
        threading = {
          inReplyTo: headers.messageId,
          references: replyReferences(headers.references, headers.messageId),
        }
      }
    }

    const messageId = newMessageId(account.email)
    const { raw, sentCopy } = await buildMessage({
      from: { ...(account.senderName ? { name: account.senderName } : {}), email: account.email },
      ...fields,
      subject: draft.subject,
      text: draft.body,
      attachments,
      ...threading,
      date: (this.deps.now ?? (() => new Date()))(),
      messageId,
    })

    const { copy, rejected } = await provider.send({
      envelope: { from: account.email, to: everyone.map((a) => a.email) },
      raw,
      sentCopy,
      messageId,
    })
    this.attachments.release(draft.attachments.map((a) => a.id))

    // After the message is out, nothing below may make it look as if sending failed.
    if (isReply && draft.sourceMessageId) {
      await this.deps.mail
        .setFlags(draft.accountId, [draft.sourceMessageId], { answered: true })
        .catch(() => undefined)
    }
    if (copy.saved)
      void this.deps.mail.syncFolder(draft.accountId, copy.folderId).catch(() => undefined)
    return { status: 'sent', copySaved: copy.saved, rejected }
  }
}
