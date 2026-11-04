import {
  Archive,
  CalendarDays,
  CircleMinus,
  FilePen,
  Folder as FolderIcon,
  Inbox,
  Mail,
  OctagonAlert,
  Plus,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { AppInfo } from '@shared/ipc-contract'
import type { Account, AccountId, Folder, FolderId, FolderRole } from '@shared/types/mail'
import { cn } from '../lib/cn'
import type { AsyncState } from '../lib/use-async'

export type View = 'mail' | 'calendar'

/** The folders of one account, or why they couldn't be loaded. */
export type AccountFolders = { accountId: AccountId } & (
  { status: 'ready'; folders: Folder[] } | { status: 'error'; message: string }
)

export interface FolderSelection {
  accountId: AccountId
  folderId: FolderId
}

const FOLDER_ICONS: Record<FolderRole, LucideIcon> = {
  inbox: Inbox,
  drafts: FilePen,
  sent: Send,
  archive: Archive,
  junk: OctagonAlert,
  trash: Trash2,
  custom: FolderIcon,
}

interface SidebarProps {
  view: View
  onViewChange: (view: View) => void
  accounts: AsyncState<Account[]>
  folders: AsyncState<AccountFolders[]>
  selection: FolderSelection | undefined
  onSelectFolder: (selection: FolderSelection) => void
  onAddAccount: () => void
  onRemoveAccount: (account: Account) => void
  appInfo: AppInfo | undefined
}

export function Sidebar(props: SidebarProps) {
  const { view, onViewChange, accounts, appInfo } = props
  const accountList = accounts.status === 'ready' ? accounts.data : []
  const onlySample = accountList.length > 0 && accountList.every((a) => a.kind === 'mock')

  return (
    <nav
      aria-label="Mailboxes"
      className="flex w-56 shrink-0 flex-col border-r border-line bg-sidebar"
    >
      {/* Space for the macOS window buttons; dragging here moves the window. */}
      <div className="drag-region h-[52px] shrink-0" />

      <div
        role="group"
        aria-label="View"
        className="mx-3 mb-4 grid grid-cols-2 gap-1 rounded-lg bg-ink/5 p-0.5"
      >
        <ViewToggle
          icon={Mail}
          label="Mail"
          active={view === 'mail'}
          onClick={() => onViewChange('mail')}
        />
        <ViewToggle
          icon={CalendarDays}
          label="Calendar"
          active={view === 'calendar'}
          onClick={() => onViewChange('calendar')}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {view === 'mail' && accounts.status === 'error' && (
          <Notice>Accounts could not be loaded: {accounts.message}</Notice>
        )}
        {view === 'mail' &&
          accountList.map((account) => (
            <AccountSection key={account.id} account={account} {...props} />
          ))}
        {view === 'mail' && accounts.status === 'ready' && (
          <button
            type="button"
            onClick={props.onAddAccount}
            className="mt-2 flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-ink-muted hover:bg-ink/5 hover:text-ink"
          >
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            Add account
          </button>
        )}
      </div>

      <footer className="shrink-0 px-4 pt-3 pb-4 text-[11px] leading-snug text-ink-faint">
        {onlySample && <p>Sample data until you add an account.</p>}
        {appInfo && (
          <p className="mt-1 tabular-nums">
            Version {appInfo.version}, milestone {appInfo.milestone}
          </p>
        )}
      </footer>
    </nav>
  )
}

function AccountSection({
  account,
  folders,
  selection,
  onSelectFolder,
  onRemoveAccount,
}: SidebarProps & { account: Account }) {
  const result =
    folders.status === 'ready' ? folders.data.find((f) => f.accountId === account.id) : undefined
  const canRemove = account.kind !== 'mock'

  return (
    <section aria-label={account.name} className="mb-3">
      <div className="group flex h-6 items-center gap-1 px-2">
        <h2
          className="flex-1 truncate text-[11px] font-semibold text-ink-faint"
          title={account.email}
        >
          {account.name}
        </h2>
        {canRemove && (
          <button
            type="button"
            aria-label={`Remove ${account.name}`}
            title="Remove account"
            onClick={() => onRemoveAccount(account)}
            className="grid size-5 place-items-center rounded text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-ink/8 hover:text-ink focus-visible:opacity-100"
          >
            <CircleMinus className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {folders.status === 'loading' && <Notice>Loading folders…</Notice>}
      {result?.status === 'error' && <Notice>Folders could not be loaded: {result.message}</Notice>}
      {result?.status === 'ready' && (
        <ul>
          {result.folders.map((folder) => {
            const Icon = FOLDER_ICONS[folder.role]
            const selected = selection?.accountId === account.id && selection.folderId === folder.id
            return (
              <li key={folder.id}>
                <button
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onSelectFolder({ accountId: account.id, folderId: folder.id })}
                  className={cn(
                    'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px]',
                    selected ? 'bg-accent-soft font-medium text-ink' : 'text-ink hover:bg-ink/5',
                  )}
                >
                  <Icon
                    className={cn('size-4 shrink-0', selected ? 'text-accent' : 'text-ink-muted')}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{folder.name}</span>
                  {folder.unreadCount > 0 && (
                    <span className="text-[12px] font-semibold tabular-nums text-accent">
                      {folder.unreadCount}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="px-2 py-1 text-[12px] leading-snug text-ink-muted">
      {children}
    </p>
  )
}

/** One half of the Mail / Calendar switch: a toggle button, pressed while its view is shown. */
function ViewToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium',
        active
          ? 'bg-paper text-ink shadow-[0_0_0_0.5px_var(--line)]'
          : 'text-ink-muted hover:text-ink',
      )}
    >
      <Icon className="size-3.5" strokeWidth={2} aria-hidden />
      {label}
    </button>
  )
}
