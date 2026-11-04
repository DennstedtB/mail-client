import { describe, expect, it } from 'vitest'
import type { ListResponse } from 'imapflow'
import { toFolders } from './folders'

function mailbox(
  path: string,
  specialUse?: string,
  status?: { unseen: number; messages: number },
  flags: string[] = [],
): ListResponse {
  const parts = path.split('/')
  return {
    path,
    pathAsListed: path,
    name: parts.at(-1) ?? path,
    delimiter: '/',
    parent: parts.slice(0, -1),
    parentPath: parts.slice(0, -1).join('/'),
    flags: new Set(flags),
    specialUse,
    listed: true,
    subscribed: true,
    status: status ? { path, ...status } : undefined,
  } as ListResponse
}

describe('toFolders', () => {
  // The folder set the Stalwart test server creates for a new account.
  const stalwart = [
    mailbox('INBOX', '\\Inbox', { unseen: 2, messages: 5 }),
    mailbox('Sent Items', '\\Sent', { unseen: 0, messages: 1 }),
    mailbox('Drafts', '\\Drafts'),
    mailbox('Junk Mail', '\\Junk'),
    mailbox('Deleted Items', '\\Trash'),
  ]

  it('maps special-use flags to roles and sorts well-known folders first', () => {
    const folders = toFolders('acc', [mailbox('Projects'), ...stalwart])
    expect(folders.map((f) => `${f.role}:${f.name}`)).toEqual([
      'inbox:Inbox',
      'drafts:Drafts',
      'sent:Sent Items',
      'junk:Junk Mail',
      'trash:Deleted Items',
      'custom:Projects',
    ])
  })

  it('uses the IMAP path as id and takes counts from STATUS', () => {
    const [inbox] = toFolders('acc', stalwart)
    expect(inbox).toEqual({
      id: 'INBOX',
      accountId: 'acc',
      name: 'Inbox',
      role: 'inbox',
      unreadCount: 2,
      totalCount: 5,
    })
  })

  it('treats missing STATUS as zero', () => {
    const drafts = toFolders('acc', stalwart).find((f) => f.role === 'drafts')
    expect(drafts?.unreadCount).toBe(0)
    expect(drafts?.totalCount).toBe(0)
  })

  it('skips mailboxes that cannot hold messages', () => {
    const folders = toFolders('acc', [
      mailbox('INBOX', '\\Inbox'),
      mailbox('Archive', undefined, undefined, ['\\Noselect']),
      mailbox('Gone', undefined, undefined, ['\\NonExistent']),
    ])
    expect(folders.map((f) => f.id)).toEqual(['INBOX'])
  })

  it('shows nested folders with their parents and sorts them by name', () => {
    const folders = toFolders('acc', [mailbox('Projects/beta'), mailbox('Projects/Alpha')])
    expect(folders.map((f) => f.name)).toEqual(['Projects / Alpha', 'Projects / beta'])
  })
})
