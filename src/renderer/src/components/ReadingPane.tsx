import { useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  Download,
  Flag,
  Forward,
  ImageOff,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  Trash2,
} from 'lucide-react'
import type { Address, Attachment, Message } from '@shared/types/mail'
import { errorMessage } from '../lib/errors'
import { displayName, formatFileSize, formatFullDate } from '../lib/format'
import { linkify, prepareHtml, splitQuotes } from '../lib/sanitize-html'
import type { AsyncState } from '../lib/use-async'
import { Avatar } from './Avatar'
import { ToolbarButton } from './ToolbarButton'

const api = window.api

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

      <div className="flex min-h-0 flex-1 flex-col">
        {message.status === 'idle' && <EmptyState {...empty} />}
        {message.status === 'loading' && <p className="p-12 text-ink-muted">Loading message…</p>}
        {message.status === 'error' && (
          <p className="p-12 text-ink-muted">The message could not be loaded: {message.message}</p>
        )}
        {message.status === 'ready' &&
          (message.data ? (
            <MessageView key={message.data.id} message={message.data} />
          ) : (
            <EmptyState {...empty} />
          ))}
      </div>
    </section>
  )
}

function MessageView({ message }: { message: Message }) {
  const header = (
    <header className="selectable mx-auto w-full max-w-[46rem] px-12 pt-9">
      <h1 className="font-serif text-[26px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance">
        {message.subject || '(No subject)'}
      </h1>

      <div className="mt-6 flex items-start gap-3">
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
      </div>

      {message.attachments.length > 0 && <Attachments message={message} />}
    </header>
  )

  // HTML mail gets its own sandboxed frame that fills the pane and scrolls on its own.
  // The frame keeps a minimum height; with a very tall header the pane scrolls instead.
  if (message.bodyHtml) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {header}
        <HtmlBody html={message.bodyHtml} />
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {header}
      <div className="selectable mx-auto max-w-[46rem] px-12 pb-16">
        <div className="mt-7 border-t border-line pt-7 font-serif text-[16.5px] leading-[1.65] whitespace-pre-wrap">
          <PlainText text={message.bodyText} />
        </div>
      </div>
    </div>
  )
}

function PlainText({ text }: { text: string }) {
  const blocks = useMemo(() => splitQuotes(text), [text])
  return (
    <>
      {blocks.map((block, index) =>
        block.quoted ? (
          <blockquote key={index} className="my-1 border-l-2 border-line pl-4 text-ink-muted">
            <Linkified text={block.text} />
          </blockquote>
        ) : (
          <Linkified key={index} text={block.text} />
        ),
      )}
    </>
  )
}

function Linkified({ text }: { text: string }) {
  const segments = useMemo(() => linkify(text), [text])
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'link' ? (
          <a
            key={index}
            href={segment.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  )
}

function HtmlBody({ html }: { html: string }) {
  const [allowRemoteImages, setAllowRemoteImages] = useState(false)
  const prepared = useMemo(
    () => prepareHtml(html, { allowRemoteImages }),
    [html, allowRemoteImages],
  )

  return (
    <div className="mt-6 flex min-h-80 flex-1 flex-col border-t border-line">
      {prepared.hasRemoteContent && !allowRemoteImages && (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 text-[12.5px] text-ink-muted">
          <ImageOff className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="flex-1">
            Remote images are blocked, so the sender can't see that you opened this message.
          </span>
          <button
            type="button"
            onClick={() => setAllowRemoteImages(true)}
            className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft"
          >
            Load images
          </button>
        </div>
      )}
      <iframe
        title="Message content"
        // No scripts, no access to the app; links may only open in the default browser.
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={prepared.srcdoc}
        className="min-h-0 w-full flex-1 bg-white"
      />
    </div>
  )
}

function Attachments({ message }: { message: Message }) {
  const [problem, setProblem] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setProblem(null)
    try {
      await action()
    } catch (error) {
      setProblem(errorMessage(error))
    }
  }

  return (
    <div className="mt-5">
      <ul aria-label="Attachments" className="flex flex-wrap gap-2">
        {message.attachments.map((attachment) => (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            onOpen={() =>
              run(() => api.mail.openAttachment(message.accountId, message.id, attachment.id))
            }
            onSave={() =>
              run(() => api.mail.saveAttachment(message.accountId, message.id, attachment.id))
            }
          />
        ))}
      </ul>
      {problem && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {problem}
        </p>
      )}
    </div>
  )
}

function AttachmentChip({
  attachment,
  onOpen,
  onSave,
}: {
  attachment: Attachment
  onOpen: () => void
  onSave: () => void
}): ReactNode {
  return (
    <li className="flex items-stretch overflow-hidden rounded-md border border-line text-[12.5px]">
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${attachment.filename}`}
        className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-ink/5"
      >
        <Paperclip className="size-3.5 text-ink-muted" strokeWidth={2} aria-hidden />
        <span className="font-medium">{attachment.filename}</span>
        <span className="text-ink-muted tabular-nums">{formatFileSize(attachment.size)}</span>
      </button>
      <button
        type="button"
        onClick={onSave}
        aria-label={`Save ${attachment.filename}`}
        title="Save…"
        className="grid w-8 place-items-center border-l border-line text-ink-muted hover:bg-ink/5 hover:text-ink"
      >
        <Download className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
    </li>
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
