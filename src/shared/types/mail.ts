/**
 * Mail domain types shared by the main process and the UI.
 *
 * Everything here must stay JSON-serializable (no Date, Map, class instances):
 * it crosses the IPC boundary today and would cross a Tauri boundary later.
 * Dates are ISO 8601 strings.
 */

export type AccountId = string
export type FolderId = string
export type MessageId = string

/** Which provider implementation serves an account. */
export type AccountKind = 'mock' | 'imap' | 'graph'

export interface Account {
  id: AccountId
  /** Label chosen by the user, e.g. "Work". */
  name: string
  /** Name recipients see in the From line. */
  senderName: string
  email: string
  kind: AccountKind
}

/** Well-known folder roles; IMAP SPECIAL-USE and Graph well-known folders both map onto these. */
export type FolderRole = 'inbox' | 'drafts' | 'sent' | 'archive' | 'junk' | 'trash' | 'custom'

export interface Folder {
  id: FolderId
  accountId: AccountId
  name: string
  role: FolderRole
  unreadCount: number
  totalCount: number
}

export interface Address {
  name?: string
  email: string
}

export interface MessageSummary {
  id: MessageId
  accountId: AccountId
  folderId: FolderId
  from: Address
  subject: string
  /** Plain-text snippet of the body for the message list. */
  preview: string
  /** ISO 8601 */
  date: string
  isRead: boolean
  isFlagged: boolean
  /** Replied to (IMAP \\Answered). */
  isAnswered: boolean
  hasAttachments: boolean
}

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  /** Size in bytes. */
  size: number
}

export interface Message extends MessageSummary {
  to: Address[]
  cc: Address[]
  bodyText: string
  /**
   * HTML body as the sender wrote it. Never render it directly: the UI
   * sanitizes it and shows it in a sandboxed frame (see sanitize-html.ts).
   */
  bodyHtml?: string
  /** Attachments shown to the user; inline images are already part of bodyHtml. */
  attachments: Attachment[]
}

/** Flags to set (true) or clear (false); flags that are left out stay as they are. */
export type FlagChange = Partial<Record<'seen' | 'flagged' | 'answered', boolean>>

/** The message list shows at most this many messages of a folder, the newest first. */
export const MESSAGE_LIST_LIMIT = 1000

/** Sent from the main process when the cache changed, e.g. after a sync or new mail. */
export interface MailChange {
  accountId: AccountId
  /** The folder that changed; absent when the whole account may have changed. */
  folderId?: FolderId
}
