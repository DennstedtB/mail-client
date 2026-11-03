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
  /** Display name chosen by the user, e.g. "Work". */
  name: string
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
  /** Raw HTML body. Never render it directly: it must be sanitized first (M2). */
  bodyHtml?: string
  attachments: Attachment[]
}
