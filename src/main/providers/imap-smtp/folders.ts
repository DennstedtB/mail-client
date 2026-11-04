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
  const folders = mailboxes.filter(isSelectable).map((mailbox): Folder => {
    const role = (mailbox.specialUse && SPECIAL_USE_ROLES[mailbox.specialUse]) || 'custom'
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
