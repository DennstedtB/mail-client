import { useId, useRef, type KeyboardEvent } from 'react'
import { FolderInput } from 'lucide-react'
import type { Folder, FolderId } from '@shared/types/mail'
import { cn } from '../lib/cn'
import { FOLDER_ICONS } from './Sidebar'

interface MoveMenuProps {
  /** Folders the message can go to (its own folder left out). */
  folders: Folder[]
  onMove: (folderId: FolderId) => void
  unavailableReason?: string
}

/**
 * "Move to…" button with a folder menu. Uses the browser's popover (light
 * dismiss, Escape) and anchor positioning, so it needs no positioning code.
 */
export function MoveMenu({ folders, onMove, unavailableReason }: MoveMenuProps) {
  const menuId = useId()
  const menu = useRef<HTMLDivElement>(null)
  const unavailable = Boolean(unavailableReason)

  function items() {
    return [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])]
  }

  function handleKeyDown(event: KeyboardEvent) {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = (index + 1) % list.length
    else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = list.length - 1
    if (next === undefined) return
    event.preventDefault()
    list[next]?.focus()
  }

  return (
    <>
      <button
        type="button"
        aria-label="Move to"
        aria-haspopup="menu"
        aria-disabled={unavailable || undefined}
        title={unavailable ? `Move to: ${unavailableReason}` : 'Move to…'}
        popoverTarget={unavailable ? undefined : menuId}
        className={cn(
          'no-drag grid size-8 place-items-center rounded-md text-ink-muted [anchor-name:--move-menu]',
          unavailable ? 'opacity-45' : 'hover:bg-ink/6 hover:text-ink active:bg-ink/10',
        )}
      >
        <FolderInput className="size-[17px]" strokeWidth={1.75} aria-hidden />
      </button>
      <div
        ref={menu}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label="Move to folder"
        onToggle={(event) => {
          if (event.newState === 'open') items()[0]?.focus()
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'no-drag m-0 mt-1 max-h-[60vh] min-w-52 overflow-y-auto rounded-lg border border-line bg-paper p-1 text-ink',
          'shadow-[0_12px_32px_rgba(0,0,0,0.18)] [inset:auto] [position-anchor:--move-menu]',
          '[top:anchor(bottom)] [left:anchor(left)]',
        )}
      >
        {folders.map((folder) => {
          const Icon = FOLDER_ICONS[folder.role]
          return (
            <button
              key={folder.id}
              type="button"
              role="menuitem"
              onClick={() => {
                menu.current?.hidePopover()
                onMove(folder.id)
              }}
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none hover:bg-ink/6 focus:bg-accent-soft"
            >
              <Icon className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{folder.name}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
