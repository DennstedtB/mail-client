import type { ImapFlow, ListResponse } from 'imapflow'
import type { FolderId } from '@shared/types/mail'
import type { OutgoingMessage } from '../types'

/** Folder names servers without SPECIAL-USE commonly use for sent mail. */
const SENT_NAMES = [
  'sent',
  'sent items',
  'sent messages',
  'sent mail',
  'gesendet',
  'gesendete elemente',
]

const selectable = (m: ListResponse) => !m.flags.has('\\Noselect') && !m.flags.has('\\NonExistent')

/**
 * The name of a top-level folder, or null for a nested one. Servers with an
 * "INBOX." namespace keep top-level folders below the inbox ("INBOX.Sent").
 */
function topLevelName(mailbox: Pick<ListResponse, 'path' | 'delimiter'>): string | null {
  const { delimiter } = mailbox
  let path = mailbox.path
  if (delimiter && path.toUpperCase().startsWith(`INBOX${delimiter}`)) path = path.slice(6)
  return delimiter && path.includes(delimiter) ? null : path.toLowerCase()
}

/**
 * The folder for sent mail: the one marked \Sent, otherwise a top-level
 * folder with a common name (never one nested in, say, an archive).
 * Null if there is none; then a folder "Sent" is created.
 */
export function pickSentFolder(mailboxes: ListResponse[]): FolderId | null {
  const usable = mailboxes.filter(selectable)
  const special = usable.find((m) => m.specialUse === '\\Sent')
  if (special) return special.path
  for (const name of SENT_NAMES) {
    const match = usable.find((m) => topLevelName(m) === name)
    if (match) return match.path
  }
  return null
}

async function containsMessageId(client: ImapFlow, folder: FolderId, messageId: string) {
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const found = await client.search({ header: { 'message-id': messageId } }, { uid: true })
    return Array.isArray(found) && found.length > 0
  } finally {
    lock.release()
  }
}

/**
 * Appends the sent copy, marked as read. Some servers (Gmail, Outlook.com)
 * file messages sent through them on their own; then there's nothing to do.
 */
export async function saveSentCopy(client: ImapFlow, message: OutgoingMessage): Promise<FolderId> {
  let folder = pickSentFolder(await client.list())
  if (!folder) folder = (await client.mailboxCreate('Sent')).path
  if (await containsMessageId(client, folder, message.messageId)) return folder
  await client.append(folder, message.sentCopy, ['\\Seen'], new Date())
  return folder
}
