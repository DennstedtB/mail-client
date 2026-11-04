/**
 * Provider interfaces: one implementation per protocol family.
 *
 *   MockMailProvider            sample mailbox while no account exists
 *   ImapSmtpMailProvider        ImapFlow + Nodemailer
 *   CalDavCalendarProvider      M5 (tsdav + ical.js)
 *   GraphMailProvider, …        M6 (Microsoft 365)
 *
 * Services and the UI never talk to a protocol library directly; they go
 * through these interfaces. Providers write into the local cache; the UI
 * reads from it.
 */

import type { Calendar, CalendarEvent, CalendarId, DateRange } from '@shared/types/calendar'
import type { Account, Folder, FolderId } from '@shared/types/mail'
import type { MailCache } from '../cache/mail-cache'
import type { MessageRef } from '../mail/message-ref'
import type { AttachmentContent, ParsedMessage } from '../mail/parse-message'

/** IMAP system flags the app changes. */
export type FlagChange = Partial<Record<'seen' | 'flagged' | 'answered', boolean>>

/** A message ready to send, built by the compose service. */
export interface OutgoingMessage {
  /** SMTP envelope: the sender and every recipient, Bcc included. */
  envelope: { from: string; to: string[] }
  /** The message as recipients get it: without a Bcc header. */
  raw: Buffer
  /** The copy for the Sent folder: with Bcc, so the sender still sees who got it. */
  sentCopy: Buffer
  /** Message-ID header, including the angle brackets. */
  messageId: string
}

/** Where the copy of a sent message went. */
export type SentCopy = { saved: true; folderId: FolderId } | { saved: false }

export interface SendOutcome {
  copy: SentCopy
  /** Recipients the server refused; the others got the message. */
  rejected: string[]
}

export interface MailProvider {
  readonly account: Account
  /** Folders with unread and total counts. */
  listFolders(): Promise<Folder[]>
  /** Brings the cache up to date for one folder. Returns true if anything changed. */
  syncFolder(folderId: FolderId, cache: MailCache): Promise<boolean>
  /** Downloads one message in full, without marking it as read. */
  fetchMessage(ref: MessageRef): Promise<ParsedMessage>
  fetchAttachment(ref: MessageRef, attachmentId: string): Promise<AttachmentContent>
  /**
   * Sends a message and saves a copy in the Sent folder. Throws a readable
   * error if sending failed; a copy that couldn't be saved doesn't count as
   * a failure (the message is out).
   */
  send(message: OutgoingMessage): Promise<SendOutcome>
  /** Adds or removes flags on messages of one folder. */
  setFlags(folderId: FolderId, uids: number[], change: FlagChange): Promise<void>
  /** Watches for new mail; calls onChange with the folder that changed. Returns a stop function. */
  watch(onChange: (folderId: FolderId) => void): () => void
  /** Closes all connections, e.g. when the account is removed. */
  close(): Promise<void>
}

export interface CalendarProvider {
  readonly account: Account
  listCalendars(): Promise<Calendar[]>
  listEvents(calendarId: CalendarId, range: DateRange): Promise<CalendarEvent[]>
}
