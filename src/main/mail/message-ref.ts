import type { FolderId, MessageId } from '@shared/types/mail'

/** Where a message lives on the server: folder (IMAP path) and UID. */
export interface MessageRef {
  folderId: FolderId
  uid: number
}

/**
 * Message ids are opaque to the UI. Internally they carry folder and UID, so
 * the main process can find the message without a lookup table. Folder paths
 * may contain any character, hence JSON rather than a separator.
 */
export function encodeMessageId(ref: MessageRef): MessageId {
  return JSON.stringify([ref.folderId, ref.uid])
}

export function decodeMessageId(id: MessageId): MessageRef {
  let value: unknown
  try {
    value = JSON.parse(id)
  } catch {
    throw new Error('Unknown message.')
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    !Number.isInteger(value[1]) ||
    (value[1] as number) < 1
  ) {
    throw new Error('Unknown message.')
  }
  return { folderId: value[0], uid: value[1] as number }
}

const PREVIEW_LENGTH = 180

/** One-line preview for the message list: no quoted lines, collapsed whitespace. */
export function makePreview(text: string, maxLength = PREVIEW_LENGTH): string {
  if (maxLength <= 0) return ''
  const withoutQuotes = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join(' ')
  const singleLine = withoutQuotes.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return `${singleLine.slice(0, maxLength - 1).trimEnd()}…`
}
