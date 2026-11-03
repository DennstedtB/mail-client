/**
 * Provider interfaces: one implementation per protocol family.
 *
 *   M0  MockMailProvider            (sample data)
 *   M1+ ImapSmtpMailProvider        (ImapFlow + Nodemailer)
 *   M5  CalDavCalendarProvider      (tsdav + ical.js)
 *   M6  GraphMailProvider, GraphCalendarProvider (Microsoft 365)
 *
 * Services and the UI never talk to a protocol library directly; they go
 * through these interfaces. New capabilities (send, flags, move, delete,
 * change notifications) are added here when their milestone starts.
 */

import type { Calendar, CalendarEvent, CalendarId, DateRange } from '@shared/types/calendar'
import type {
  Account,
  Folder,
  FolderId,
  Message,
  MessageId,
  MessageSummary,
} from '@shared/types/mail'

export interface MailProvider {
  readonly account: Account
  listFolders(): Promise<Folder[]>
  /** Newest first. */
  listMessages(folderId: FolderId): Promise<MessageSummary[]>
  getMessage(messageId: MessageId): Promise<Message | null>
}

export interface CalendarProvider {
  readonly account: Account
  listCalendars(): Promise<Calendar[]>
  listEvents(calendarId: CalendarId, range: DateRange): Promise<CalendarEvent[]>
}
