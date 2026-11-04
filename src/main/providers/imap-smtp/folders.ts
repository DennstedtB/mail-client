import type { ListResponse } from 'imapflow'
import type { AccountId, Folder, FolderRole } from '@shared/types/mail'

const SPECIAL_USE_ROLES: Record<string, FolderRole> = {
  '\\Inbox': 'inbox',
  '\\Drafts': 'drafts',
  '\\Sent': 'sent',
  '\\Archive': 'archive',
  '\\Junk': 'junk',
  '\\Trash': 'trash',
}

/**
 * Common names of well-known folders, for servers (or folders) without
 * SPECIAL-USE flags, e.g. an "Archive" folder created by this app.
 */
const ROLE_NAMES: Partial<Record<FolderRole, string[]>> = {
  drafts: ['drafts', 'entwürfe'],
  sent: ['sent', 'sent items', 'sent messages', 'sent mail', 'gesendet', 'gesendete elemente'],
  archive: ['archive', 'archives', 'archiv'],
  junk: ['junk', 'spam', 'junk mail', 'junk e-mail', 'junk-e-mail'],
  trash: ['trash', 'deleted items', 'deleted messages', 'papierkorb', 'gelöschte elemente'],
}

/**
 * The role a top-level folder has by its name alone, if any. Servers with an
 * "INBOX." namespace keep top-level folders below the inbox, e.g. "INBOX.Sent".
 */
function roleByName(mailbox: Pick<ListResponse, 'path' | 'delimiter'>): FolderRole | undefined {
  const { delimiter } = mailbox
  let path = mailbox.path
  if (delimiter && path.toUpperCase().startsWith(`INBOX${delimiter}`)) path = path.slice(6)
  if (delimiter && path.includes(delimiter)) return undefined
  const name = path.toLowerCase()
  return (Object.keys(ROLE_NAMES) as FolderRole[]).find((role) => ROLE_NAMES[role]?.includes(name))
}

/** Sidebar order: well-known folders first, in this order, then the rest alphabetically. */
const ROLE_ORDER: FolderRole[] = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash', 'custom']

/** Mailboxes that exist only as a node in the hierarchy and can't hold messages. */
function isSelectable(mailbox: Pick<ListResponse, 'flags'>): boolean {
  return !mailbox.flags.has('\\Noselect') && !mailbox.flags.has('\\NonExistent')
}

function displayName(
  mailbox: Pick<ListResponse, 'path' | 'delimiter' | 'specialUse'>,
  role: FolderRole,
) {
  if (role === 'inbox') return 'Inbox'
  // Nested custom folders keep their parents in the name, e.g. "Projects / Alpha".
  return mailbox.delimiter ? mailbox.path.split(mailbox.delimiter).join(' / ') : mailbox.path
}

/** Maps an IMAP LIST response (with STATUS) to the folders shown in the sidebar. */
export function toFolders(accountId: AccountId, mailboxes: ListResponse[]): Folder[] {
  const selectable = mailboxes.filter(isSelectable)
  const flagged = new Set(
    selectable.map((m) => m.specialUse && SPECIAL_USE_ROLES[m.specialUse]).filter(Boolean),
  )
  // A name gives a role only if no folder has that role by flag, and only to the first such folder.
  const named = new Set<FolderRole>()
  const folders = selectable.map((mailbox): Folder => {
    let role: FolderRole = (mailbox.specialUse && SPECIAL_USE_ROLES[mailbox.specialUse]) || 'custom'
    const byName = role === 'custom' ? roleByName(mailbox) : undefined
    if (byName && !flagged.has(byName) && !named.has(byName)) {
      role = byName
      named.add(byName)
    }
    return {
      id: mailbox.path,
      accountId,
      name: displayName(mailbox, role),
      role,
      unreadCount: mailbox.status?.unseen ?? 0,
      totalCount: mailbox.status?.messages ?? 0,
    }
  })
  return folders.sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}
