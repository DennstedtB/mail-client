import {
  Archive,
  CalendarDays,
  FilePen,
  Folder as FolderIcon,
  Inbox,
  Mail,
  OctagonAlert,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { AppInfo } from '@shared/ipc-contract'
import type { Account, Folder, FolderId, FolderRole } from '@shared/types/mail'
import { cn } from '../lib/cn'

export type View = 'mail' | 'calendar'

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
  account: Account | undefined
  folders: Folder[]
  selectedFolderId: FolderId | undefined
  onSelectFolder: (folderId: FolderId) => void
  /** Shown instead of the folder list, e.g. a load error or "no account yet". */
  notice?: string
  appInfo: AppInfo | undefined
}

export function Sidebar({
  view,
  onViewChange,
  account,
  folders,
  selectedFolderId,
  onSelectFolder,
  notice,
  appInfo,
}: SidebarProps) {
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

      {view === 'mail' && notice && (
        <p role="status" className="px-4 text-[12px] leading-snug text-ink-muted">
          {notice}
        </p>
      )}

      {view === 'mail' && !notice && account && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <h2
            className="truncate px-2 pb-1 text-[11px] font-semibold text-ink-faint"
            title={account.email}
          >
            {account.name}
          </h2>
          <ul>
            {folders.map((folder) => {
              const Icon = FOLDER_ICONS[folder.role]
              const selected = folder.id === selectedFolderId
              return (
                <li key={folder.id}>
                  <button
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    onClick={() => onSelectFolder(folder.id)}
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
        </div>
      )}

      {view === 'calendar' && <div className="flex-1" />}

      <footer className="shrink-0 px-4 pt-3 pb-4 text-[11px] leading-snug text-ink-faint">
        <p>Sample data. Real accounts arrive in M1.</p>
        {appInfo && (
          <p className="mt-1 tabular-nums">
            Version {appInfo.version}, milestone {appInfo.milestone}
          </p>
        )}
      </footer>
    </nav>
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
