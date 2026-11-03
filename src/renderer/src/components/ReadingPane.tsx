import { Archive, Flag, Forward, Mail, Paperclip, Reply, ReplyAll, Trash2 } from 'lucide-react'
import type { Address, Message } from '@shared/types/mail'
import { displayName, formatFileSize, formatFullDate } from '../lib/format'
import type { AsyncState } from '../lib/use-async'
import { Avatar } from './Avatar'
import { ToolbarButton } from './ToolbarButton'

const COMPOSE_LATER = 'coming in M3'
const ACTIONS_LATER = 'coming in M4'

interface EmptyText {
  title: string
  hint: string
}

const NO_SELECTION: EmptyText = {
  title: 'No message selected',
  hint: 'Choose a message from the list to read it here.',
}

export function ReadingPane({
  message,
  empty = NO_SELECTION,
}: {
  message: AsyncState<Message | null>
  /** What to say while nothing is shown. */
  empty?: EmptyText
}) {
  return (
    <section aria-label="Reading pane" className="flex min-w-0 flex-1 flex-col bg-paper">
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-0.5 border-b border-line px-4">
        <ToolbarButton icon={Reply} label="Reply" unavailableReason={COMPOSE_LATER} />
        <ToolbarButton icon={ReplyAll} label="Reply all" unavailableReason={COMPOSE_LATER} />
        <ToolbarButton icon={Forward} label="Forward" unavailableReason={COMPOSE_LATER} />
        <div className="mx-2 h-5 w-px bg-line" />
        <ToolbarButton icon={Archive} label="Archive" unavailableReason={ACTIONS_LATER} />
        <ToolbarButton icon={Trash2} label="Delete" unavailableReason={ACTIONS_LATER} />
        <ToolbarButton icon={Flag} label="Flag" unavailableReason={ACTIONS_LATER} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {message.status === 'idle' && <EmptyState {...empty} />}
        {message.status === 'loading' && <p className="p-12 text-ink-muted">Loading message…</p>}
        {message.status === 'error' && (
          <p className="p-12 text-ink-muted">The message could not be loaded: {message.message}</p>
        )}
        {message.status === 'ready' &&
          (message.data ? <MessageView message={message.data} /> : <EmptyState {...empty} />)}
      </div>
    </section>
  )
}

function MessageView({ message }: { message: Message }) {
  return (
    <article className="selectable mx-auto max-w-[46rem] px-12 pt-9 pb-16">
      <h1 className="font-serif text-[26px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance">
        {message.subject || '(No subject)'}
      </h1>

      <header className="mt-6 flex items-start gap-3">
        <Avatar address={message.from} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px]">
            <span className="font-semibold">{displayName(message.from)}</span>
            {message.from.name && (
              <span className="ml-1.5 text-ink-muted">{message.from.email}</span>
            )}
          </p>
          <p className="truncate text-[12.5px] text-ink-muted" title={formatRecipients(message.to)}>
            To: {formatRecipients(message.to)}
          </p>
          {message.cc.length > 0 && (
            <p
              className="truncate text-[12.5px] text-ink-muted"
              title={formatRecipients(message.cc)}
            >
              Cc: {formatRecipients(message.cc)}
            </p>
          )}
        </div>
        <time
          dateTime={message.date}
          className="shrink-0 pt-0.5 text-[12.5px] text-ink-muted tabular-nums"
        >
          {formatFullDate(message.date)}
        </time>
      </header>

      {message.attachments.length > 0 && (
        <ul aria-label="Attachments" className="mt-5 flex flex-wrap gap-2">
          {message.attachments.map((attachment) => (
            <li
              key={attachment.id}
              title="Opening attachments arrives in M2"
              className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12.5px]"
            >
              <Paperclip className="size-3.5 text-ink-muted" strokeWidth={2} aria-hidden />
              <span className="font-medium">{attachment.filename}</span>
              <span className="text-ink-muted tabular-nums">{formatFileSize(attachment.size)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-7 border-t border-line pt-7 font-serif text-[16.5px] leading-[1.65] whitespace-pre-wrap">
        {message.bodyText}
      </div>
    </article>
  )
}

function EmptyState({ title, hint }: EmptyText) {
  return (
    <div className="grid h-full place-items-center p-12">
      <div className="text-center text-ink-muted">
        <Mail className="mx-auto mb-3 size-8 text-ink-faint" strokeWidth={1.25} aria-hidden />
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <p className="mt-1 text-[12.5px]">{hint}</p>
      </div>
    </div>
  )
}

function formatRecipients(addresses: Address[]): string {
  return addresses.map(displayName).join(', ')
}
