import type {
  FetchMessageObject,
  ImapFlow,
  MessageAddressObject,
  MessageStructureObject,
} from 'imapflow'
import type { AccountId, Address, FolderId } from '@shared/types/mail'
import type { CachedEnvelope, CachedFlags, MailCache } from '../../cache/mail-cache'

/** How many of the newest messages a folder starts with in the cache. */
export const INITIAL_WINDOW = 300

/** Types mailparser treats as message text unless they are explicitly attachments. */
const BODY_TYPES = ['text/plain', 'text/html', 'message/delivery-status']

/**
 * True if any leaf part is meant as a file: an attachment, or a named part
 * that isn't message text (the same rule mailparser uses for the attachment list).
 */
export function hasAttachmentParts(node: MessageStructureObject | undefined): boolean {
  if (!node) return false
  if (node.childNodes?.length) return node.childNodes.some(hasAttachmentParts)
  if (node.disposition === 'attachment') return true
  const named = Boolean(node.dispositionParameters?.['filename'] || node.parameters?.['name'])
  return named && !BODY_TYPES.includes(node.type.toLowerCase()) && node.disposition !== 'inline'
}

function toAddress(value: MessageAddressObject | undefined): Address | undefined {
  if (!value?.address) return undefined
  return { ...(value.name ? { name: value.name } : {}), email: value.address }
}

function toAddresses(values: MessageAddressObject[] | undefined): Address[] {
  return (values ?? []).map(toAddress).filter((a): a is Address => a !== undefined)
}

function toIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function toFlags(uid: number, flags: Set<string> | undefined): CachedFlags {
  return {
    uid,
    seen: flags?.has('\\Seen') ?? false,
    flagged: flags?.has('\\Flagged') ?? false,
    answered: flags?.has('\\Answered') ?? false,
  }
}

/** Maps an IMAP FETCH result (envelope, flags, structure) to a cache row. */
export function toCachedEnvelope(message: FetchMessageObject): CachedEnvelope {
  const envelope = message.envelope
  return {
    ...toFlags(message.uid, message.flags),
    messageId: envelope?.messageId,
    subject: envelope?.subject?.trim() ?? '',
    from: toAddress(envelope?.from?.[0]) ?? toAddress(envelope?.sender?.[0]) ?? { email: '' },
    to: toAddresses(envelope?.to),
    cc: toAddresses(envelope?.cc),
    date: toIso(envelope?.date) ?? toIso(message.internalDate) ?? new Date(0).toISOString(),
    hasAttachments: hasAttachmentParts(message.bodyStructure),
    size: message.size ?? 0,
  }
}

const ENVELOPE_QUERY = {
  uid: true,
  flags: true,
  envelope: true,
  bodyStructure: true,
  size: true,
  internalDate: true,
} as const

/**
 * Brings the cache for one folder up to date:
 * new messages by UID, then flags and deletions for everything cached.
 * The folder is opened read-only (EXAMINE), so syncing never marks mail as read.
 * Returns true if anything in the cache changed.
 */
export async function syncImapFolder(
  client: ImapFlow,
  cache: MailCache,
  accountId: AccountId,
  folder: FolderId,
): Promise<boolean> {
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const mailbox = client.mailbox
    if (!mailbox) throw new Error(`The folder ${folder} could not be opened.`)
    const uidValidity = String(mailbox.uidValidity)
    let state = cache.folderState(accountId, folder)
    let changed = false

    if (state && state.uidValidity !== uidValidity) {
      // The server renumbered the folder: everything cached is meaningless now.
      cache.resetFolder(accountId, folder)
      state = null
      changed = true
    }

    let highestUid = state?.highestUid ?? 0
    if (mailbox.exists > 0) {
      // New messages: above the highest known UID, or the newest window on a first sync.
      const range = state
        ? { range: `${state.highestUid + 1}:*`, uid: true }
        : { range: `${Math.max(1, mailbox.exists - INITIAL_WINDOW + 1)}:*`, uid: false }
      const fresh: CachedEnvelope[] = []
      for await (const message of client.fetch(range.range, ENVELOPE_QUERY, { uid: range.uid })) {
        // "n:*" also returns the last message when nothing is newer than n.
        if (message.uid <= highestUid) continue
        fresh.push(toCachedEnvelope(message))
      }
      if (fresh.length > 0) {
        cache.upsertMessages(accountId, folder, fresh)
        highestUid = Math.max(highestUid, ...fresh.map((m) => m.uid))
        changed = true
      }
    }

    // Flags and deletions for what was cached before this sync.
    if (state) {
      const cached = cache.cachedUids(accountId, folder).filter((uid) => uid <= state!.highestUid)
      if (cached.length > 0) {
        const present = new Set<number>()
        const flags: CachedFlags[] = []
        if (mailbox.exists > 0) {
          for await (const message of client.fetch(
            `${cached[0]}:${state.highestUid}`,
            { uid: true, flags: true },
            { uid: true },
          )) {
            present.add(message.uid)
            flags.push(toFlags(message.uid, message.flags))
          }
        }
        if (cache.updateFlags(accountId, folder, flags) > 0) changed = true
        const removed = cached.filter((uid) => !present.has(uid))
        if (removed.length > 0) {
          cache.removeMessages(accountId, folder, removed)
          changed = true
        }
      }
    }

    cache.setFolderState(accountId, folder, { uidValidity, highestUid })
    return changed
  } finally {
    lock.release()
  }
}

/** Downloads a full message without changing its \Seen flag. */
export async function downloadSource(
  client: ImapFlow,
  folder: FolderId,
  uid: number,
): Promise<Buffer> {
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
    if (!message || !message.source) throw new Error('This message no longer exists on the server.')
    return message.source
  } finally {
    lock.release()
  }
}
