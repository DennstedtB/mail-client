import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Flag, LoaderCircle, Paperclip, Reply, RotateCw, Search, SquarePen } from 'lucide-react'
import type { Folder, MessageId, MessageSummary } from '@shared/types/mail'
import { cn } from '../lib/cn'
import { displayName, formatListDate } from '../lib/format'
import type { AsyncState } from '../lib/use-async'
import { ToolbarButton } from './ToolbarButton'

interface MessageListProps {
  folder: Folder | undefined
  messages: AsyncState<MessageSummary[]>
  selectedId: MessageId | null
  onSelect: (id: MessageId) => void
  /** Reference date for relative dates ("Yesterday"); changes at midnight. */
  today: Date
  /** State of the sync with the server; the list itself always comes from the cache. */
  sync: SyncState
  onRefresh: () => void
  onNewMessage: () => void
  /** Why a new message can't be written, e.g. in the sample mailbox. */
  newMessageUnavailable?: string
}

export type SyncState =
  { status: 'running' } | { status: 'done' } | { status: 'error'; message: string }

const optionId = (id: MessageId) => `message-${id}`

export function MessageList({
  folder,
  messages,
  selectedId,
  onSelect,
  today,
  sync,
  onRefresh,
  onNewMessage,
  newMessageUnavailable,
}: MessageListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const items = messages.status === 'ready' ? messages.data : []

  // Keep the selected row visible when moving with the keyboard.
  useEffect(() => {
    if (!selectedId) return
    document.getElementById(optionId(selectedId))?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (items.length === 0) return
    const index = items.findIndex((m) => m.id === selectedId)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = Math.min(index + 1, items.length - 1)
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next === undefined) return
    event.preventDefault()
    const target = items[next]
    if (target) onSelect(target.id)
  }

  return (
    <section
      aria-label="Message list"
      className="flex w-[360px] shrink-0 flex-col border-r border-line bg-surface"
    >
      <header className="drag-region flex h-[52px] shrink-0 items-center gap-2 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] leading-tight font-semibold">
            {folder?.name ?? ' '}
          </h1>
          <p className="text-[11px] leading-tight text-ink-muted">
            {sync.status === 'running' ? 'Checking for new mail…' : folderSummary(folder)}
          </p>
        </div>
        {folder && (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Check for new mail"
            title="Check for new mail"
            aria-disabled={sync.status === 'running' || undefined}
            className="no-drag grid size-8 place-items-center rounded-md text-ink-muted hover:bg-ink/6 hover:text-ink"
          >
            {sync.status === 'running' ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <RotateCw className="size-4" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        )}
        {folder && (
          <ToolbarButton
            icon={SquarePen}
            label="New message"
            unavailableReason={newMessageUnavailable}
            onClick={onNewMessage}
          />
        )}
      </header>
      {sync.status === 'error' && (
        <p
          role="status"
          className="mx-3 mb-2 rounded-md bg-danger/8 px-2.5 py-1.5 text-[11.5px] text-danger"
        >
          Couldn't check for new mail: {sync.message}
        </p>
      )}

      <div className="px-3 pb-2">
        <label
          className="flex h-7 items-center gap-1.5 rounded-md bg-ink/5 px-2 text-ink-faint"
          title="Search arrives in M4"
        >
          <Search className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <input
            type="search"
            disabled
            placeholder="Search mail"
            aria-label="Search mail"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>

      {messages.status === 'loading' && <ListNote>Loading messages…</ListNote>}
      {messages.status === 'error' && <ListNote>{messages.message}</ListNote>}
      {messages.status === 'ready' && items.length === 0 && (
        <ListNote>
          {sync.status === 'running'
            ? 'Loading messages from the server…'
            : `No messages in ${folder?.name ?? 'this folder'}.`}
        </ListNote>
      )}

      {items.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={`Messages in ${folder?.name ?? 'folder'}`}
          aria-activedescendant={selectedId ? optionId(selectedId) : undefined}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="group min-h-0 flex-1 overflow-y-auto border-t border-line outline-none"
        >
          {items.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              selected={message.id === selectedId}
              today={today}
              onSelect={() => {
                onSelect(message.id)
                listRef.current?.focus()
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function MessageRow({
  message,
  selected,
  today,
  onSelect,
}: {
  message: MessageSummary
  selected: boolean
  today: Date
  onSelect: () => void
}) {
  const unread = !message.isRead
  return (
    <li
      id={optionId(message.id)}
      role="option"
      aria-selected={selected}
      onMouseDown={(event) => {
        event.preventDefault()
        onSelect()
      }}
      className={cn(
        'relative border-b border-line py-2.5 pr-4 pl-7',
        selected
          ? 'bg-accent-soft group-focus:bg-selection group-focus:text-selection-ink'
          : 'hover:bg-ink/[0.03]',
      )}
    >
      {unread && (
        <span
          aria-label="Unread"
          className={cn(
            'absolute top-[15px] left-3 size-2 rounded-full bg-accent',
            selected && 'group-focus:bg-selection-ink',
          )}
        />
      )}

      <div className="flex items-baseline gap-2">
        <span
          className={cn('flex-1 truncate text-[13px]', unread ? 'font-semibold' : 'font-medium')}
        >
          {displayName(message.from)}
        </span>
        {message.isAnswered && (
          <Reply
            className="size-3 shrink-0 self-center opacity-60"
            strokeWidth={2}
            aria-label="Replied"
          />
        )}
        {message.hasAttachments && (
          <Paperclip
            className="size-3 shrink-0 self-center opacity-60"
            strokeWidth={2}
            aria-label="Has attachments"
          />
        )}
        {message.isFlagged && (
          <Flag
            className={cn(
              'size-3 shrink-0 self-center text-accent',
              selected && 'group-focus:text-selection-ink',
            )}
            strokeWidth={2.25}
            aria-label="Flagged"
          />
        )}
        <time
          dateTime={message.date}
          className={cn(
            'shrink-0 text-[11.5px] tabular-nums text-ink-muted',
            selected && 'group-focus:text-selection-ink/80',
          )}
        >
          {formatListDate(message.date, today)}
        </time>
      </div>
      <p className={cn('truncate text-[13px]', unread && 'font-medium')}>
        {message.subject || '(No subject)'}
      </p>
      <p
        className={cn(
          'line-clamp-2 text-[12.5px] leading-snug text-ink-muted',
          selected && 'group-focus:text-selection-ink/80',
        )}
      >
        {message.preview}
      </p>
    </li>
  )
}

function ListNote({ children }: { children: ReactNode }) {
  return <p className="border-t border-line px-4 py-6 text-[12.5px] text-ink-muted">{children}</p>
}

function folderSummary(folder: Folder | undefined): string {
  if (!folder) return ' '
  if (folder.unreadCount > 0) return `${folder.unreadCount} unread of ${folder.totalCount}`
  if (folder.totalCount === 1) return '1 message'
  return `${folder.totalCount} messages`
}
