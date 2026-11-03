/**
 * Calendar domain types. Used from M5 on; defined now so the provider
 * interfaces are complete. Same rule as mail.ts: JSON-serializable only.
 */

import type { AccountId } from './mail'

export type CalendarId = string
export type EventId = string

export interface Calendar {
  id: CalendarId
  accountId: AccountId
  name: string
  /** CSS color, as delivered by the server or chosen by the user. */
  color: string
}

export interface CalendarEvent {
  id: EventId
  calendarId: CalendarId
  title: string
  /** ISO 8601 with offset, or a plain date (YYYY-MM-DD) for all-day events. */
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
}

export interface DateRange {
  /** ISO 8601, inclusive */
  start: string
  /** ISO 8601, exclusive */
  end: string
}
