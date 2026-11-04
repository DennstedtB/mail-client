/**
 * Writing mail. A draft lives in the UI while it's written; the main process
 * prepares it (for replies and forwards) and sends it.
 */

import type { AccountId, MessageId } from './mail'

export type ComposeKind = 'new' | 'reply' | 'replyAll' | 'forward'

/**
 * An attachment of a draft. The id is a token issued by the main process:
 * the UI never sees file paths, and can only attach files the user picked
 * in the system dialog or attachments of the message being forwarded.
 */
export interface DraftAttachment {
  id: string
  filename: string
  /** Size in bytes. */
  size: number
}

export interface Draft {
  kind: ComposeKind
  /** The account that sends. */
  accountId: AccountId
  /** Recipients as typed, comma-separated, e.g. `Bob <bob@example.org>, carol@example.org`. */
  to: string
  cc: string
  bcc: string
  subject: string
  /** Plain text. */
  body: string
  attachments: DraftAttachment[]
  /** For replies and forwards: the original message. */
  sourceMessageId?: MessageId
}

export type DraftField = 'to' | 'cc' | 'bcc'

export type SendResult =
  /**
   * The message went out. copySaved is false when its copy couldn't be put in
   * Sent; rejected lists recipients the server refused (everyone else got it).
   */
  | { status: 'sent'; copySaved: boolean; rejected: string[] }
  /** Nothing was sent; the message says what to fix in which field. */
  | { status: 'invalid'; field: DraftField; message: string }
