import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Flag, LoaderCircle, Paperclip, Reply, RotateCw, Search, SquarePen, X } from 'lucide-react'
import {
  MESSAGE_LIST_LIMIT,
  type Folder,
  type MessageId,
  type MessageSummary,
} from '@shared/types/mail'
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
  /** Delete or Backspace on the selected message. */
  onDelete: (id: MessageId) => void
  search: SearchState
}

export interface SearchState {
  /** What's in the search field. */
  text: string
  onTextChange: (text: string) => void
  /** True while results (not a folder) are listed. */
  active: boolean
  /** Name of a folder, shown on each result. */
  folderName: (folderId: string) => string | undefined
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
  onDelete,
  search,
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
    else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
      event.preventDefault()
      onDelete(selectedId)
      return
    }
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
            {search.active ? 'Search' : (folder?.name ?? ' ')}
          </h1>
          <p className="text-[11px] leading-tight text-ink-muted">
            {search.active
              ? resultSummary(messages)
              : sync.status === 'running'
                ? 'Checking for new mail…'
                : folderSummary(folder)}
          </p>
        </div>
        {folder && !search.active && (
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
      {sync.status === 'error' && !search.active && (
        <p
          role="status"
          className="mx-3 mb-2 rounded-md bg-danger/8 px-2.5 py-1.5 text-[11.5px] text-danger"
        >
          Couldn't check for new mail: {sync.message}
        </p>
      )}

      <div className="px-3 pb-2">
        <label className="flex h-7 items-center gap-1.5 rounded-md bg-ink/5 pr-1 pl-2 text-ink-faint focus-within:bg-paper focus-within:ring-1 focus-within:ring-accent">
          <Search className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <input
            type="text"
            role="searchbox"
            value={search.text}
            onChange={(event) => search.onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') search.onTextChange('')
              if (event.key === 'ArrowDown' && items[0]) {
                event.preventDefault()
                onSelect(items[0].id)
                listRef.current?.focus()
              }
            }}
            placeholder="Search mail"
            aria-label="Search mail"
            spellCheck={false}
            className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
          />
          {search.text && (
            <button
              type="button"
              onClick={() => search.onTextChange('')}
              aria-label="Clear search"
              title="Clear search"
              className="grid size-5 shrink-0 place-items-center rounded text-ink-muted hover:bg-ink/8 hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          )}
        </label>
      </div>

      {messages.status === 'loading' && <ListNote>Loading messages…</ListNote>}
      {messages.status === 'error' && <ListNote>{messages.message}</ListNote>}
      {messages.status === 'ready' && items.length === 0 && search.active && (
        <ListNote>
          No messages match “{search.text.trim()}”. Search covers subject, people and the text of
          messages MailClient has downloaded, in all folders.
        </ListNote>
      )}
      {messages.status === 'ready' &&
        items.length === 0 &&
        !search.active &&
        sync.status !== 'error' && (
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
          aria-label={search.active ? 'Search results' : `Messages in ${folder?.name ?? 'folder'}`}
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
              folderName={search.active ? search.folderName(message.folderId) : undefined}
              onSelect={() => {
                onSelect(message.id)
                listRef.current?.focus()
              }}
            />
          ))}
        </ul>
      )}
      {items.length >= MESSAGE_LIST_LIMIT && !search.active && (
        <p className="shrink-0 border-t border-line px-4 py-2 text-[11.5px] text-ink-muted">
          Showing the newest {MESSAGE_LIST_LIMIT.toLocaleString()} messages of this folder.
        </p>
      )}
    </section>
  )
}

function MessageRow({
  message,
  selected,
  today,
  folderName,
  onSelect,
}: {
  message: MessageSummary
  selected: boolean
  today: Date
  /** Shown in search results, where messages come from all folders. */
  folderName?: string
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
      <div className="flex items-baseline gap-2">
        <p className={cn('min-w-0 flex-1 truncate text-[13px]', unread && 'font-medium')}>
          {message.subject || '(No subject)'}
        </p>
        {folderName && (
          <span
            className={cn(
              'max-w-[40%] shrink-0 truncate rounded bg-ink/6 px-1.5 text-[11px] text-ink-muted',
              selected && 'group-focus:bg-selection-ink/15 group-focus:text-selection-ink',
            )}
          >
            {folderName}
          </span>
        )}
      </div>
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

function resultSummary(results: AsyncState<MessageSummary[]>): string {
  if (results.status !== 'ready') return 'Searching…'
  const n = results.data.length
  return `${n === 1 ? '1 message' : `${n.toLocaleString()} messages`} in all folders`
}

function folderSummary(folder: Folder | undefined): string {
  if (!folder) return ' '
  if (folder.unreadCount > 0) return `${folder.unreadCount} unread of ${folder.totalCount}`
  if (folder.totalCount === 1) return '1 message'
  return `${folder.totalCount} messages`
}
