import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { LoaderCircle, Paperclip, Send, Trash2, X } from 'lucide-react'
import type { Draft, DraftField } from '@shared/types/compose'
import type { Account } from '@shared/types/mail'
import { cn } from '../lib/cn'
import { composeTitle, initialFocus, isDraftChanged } from '../lib/draft'
import { errorMessage } from '../lib/errors'
import { formatFileSize } from '../lib/format'
import { DiscardDraftDialog } from './DiscardDraftDialog'
import { ToolbarButton } from './ToolbarButton'

const api = window.api

export interface SentInfo {
  copySaved: boolean
  /** Recipients the server refused. */
  rejected: string[]
}

interface ComposePaneProps {
  initial: Draft
  account: Account
  /** The message went out. Also called if the pane was closed while it was sending. */
  onSent: (info: SentInfo) => void
  /** Sent or discarded: the pane should go. Only called while the pane is shown. */
  onClose: () => void
  /** Tells the app whether closing the pane would lose changes. */
  onChangedChange: (changed: boolean) => void
}

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'invalid'; field: DraftField; message: string }
  | { status: 'error'; message: string }

const LABELS: Record<DraftField, string> = { to: 'To', cc: 'Cc', bcc: 'Bcc' }

/** Writing a message: replaces the reading pane until it's sent or discarded. */
export function ComposePane({
  initial,
  account,
  onSent,
  onClose,
  onChangedChange,
}: ComposePaneProps) {
  const [draft, setDraft] = useState(initial)
  const [state, setState] = useState<SendState>({ status: 'idle' })
  const [attachError, setAttachError] = useState<string | null>(null)
  const [showCopies, setShowCopies] = useState(Boolean(initial.cc || initial.bcc))
  const [confirming, setConfirming] = useState(false)
  const fields = useRef<
    Partial<Record<DraftField | 'subject' | 'body', HTMLInputElement | HTMLTextAreaElement>>
  >({})
  const changed = isDraftChanged(initial, draft)
  const sending = state.status === 'sending'
  const titleId = useId()

  useEffect(() => onChangedChange(changed), [changed, onChangedChange])

  // However the pane closes, the main process forgets the attachments of an unsent draft.
  const latest = useRef(draft)
  useEffect(() => {
    latest.current = draft
  }, [draft])
  const sent = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (!sent.current) release(latest.current.attachments.map((a) => a.id))
    }
  }, [])

  useEffect(() => {
    const target = fields.current[initialFocus(initial)]
    target?.focus()
    // Replies start above the quoted text.
    if (target instanceof HTMLTextAreaElement) target.setSelectionRange(0, 0)
  }, [initial])

  function update(patch: Partial<Draft>) {
    // While sending, the draft stays as it was sent.
    if (sending) return
    setDraft((d) => ({ ...d, ...patch }))
    if (state.status === 'invalid' || state.status === 'error') setState({ status: 'idle' })
  }

  async function send() {
    if (sending) return
    setState({ status: 'sending' })
    try {
      const result = await api.compose.send(draft)
      if (result.status === 'invalid') {
        if (result.field !== 'to') setShowCopies(true)
        setState(result)
        // Wait for the Cc/Bcc rows to render before moving the cursor there.
        requestAnimationFrame(() => fields.current[result.field]?.focus())
        return
      }
      sent.current = true
      onSent({ copySaved: result.copySaved, rejected: result.rejected })
      // A pane that was closed meanwhile mustn't close whatever is shown now.
      if (mounted.current) onClose()
    } catch (error) {
      if (mounted.current) setState({ status: 'error', message: errorMessage(error) })
    }
  }

  async function attach() {
    setAttachError(null)
    try {
      const added = await api.compose.addAttachments()
      if (!mounted.current) return release(added.map((a) => a.id))
      if (added.length > 0) setDraft((d) => ({ ...d, attachments: [...d.attachments, ...added] }))
    } catch (error) {
      setAttachError(`Files could not be attached: ${errorMessage(error)}`)
    }
  }

  function discard() {
    onClose()
  }

  function removeAttachment(id: string) {
    if (sending) return
    update({ attachments: draft.attachments.filter((a) => a.id !== id) })
    release([id])
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void send()
    }
  }

  const recipientRow = (field: DraftField) => (
    <FieldRow
      key={field}
      label={LABELS[field]}
      error={state.status === 'invalid' && state.field === field ? state.message : undefined}
    >
      <input
        ref={(el) => {
          fields.current[field] = el ?? undefined
        }}
        type="text"
        value={draft[field]}
        readOnly={sending}
        onChange={(e) => update({ [field]: e.target.value })}
        aria-label={LABELS[field]}
        aria-invalid={(state.status === 'invalid' && state.field === field) || undefined}
        spellCheck={false}
        autoComplete="off"
        placeholder={field === 'to' ? 'Name <address>, separated by commas' : undefined}
        className="min-w-0 flex-1 bg-transparent py-2 text-[14px] outline-none placeholder:text-ink-faint"
      />
      {field === 'to' && !showCopies && (
        <button
          type="button"
          onClick={() => setShowCopies(true)}
          className="no-drag shrink-0 rounded px-1.5 py-0.5 text-[12.5px] text-ink-muted hover:bg-ink/6 hover:text-ink"
        >
          Cc / Bcc
        </button>
      )}
    </FieldRow>
  )

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-1 flex-col bg-paper"
      onKeyDown={handleKeyDown}
    >
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-1 border-b border-line px-4">
        <button
          type="button"
          onClick={() => void send()}
          aria-disabled={sending || undefined}
          title="Send (⌘↩)"
          className={cn(
            'no-drag flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-accent-contrast',
            sending ? 'opacity-70' : 'hover:brightness-110',
          )}
        >
          {sending ? (
            <LoaderCircle className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          ) : (
            <Send className="size-4" strokeWidth={2} aria-hidden />
          )}
          {sending ? 'Sending…' : 'Send'}
        </button>
        <ToolbarButton
          icon={Paperclip}
          label="Attach files"
          unavailableReason={sending ? 'sending' : undefined}
          onClick={() => void attach()}
        />
        <h2 id={titleId} className="mx-3 min-w-0 flex-1 truncate text-[13px] text-ink-muted">
          {composeTitle(draft)}
        </h2>
        <ToolbarButton
          icon={Trash2}
          label="Discard"
          onClick={() => (changed ? setConfirming(true) : discard())}
        />
      </div>

      {state.status === 'error' && (
        <p
          role="alert"
          className="border-b border-line bg-danger/8 px-6 py-2.5 text-[13px] text-danger"
        >
          {state.message}
        </p>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-[46rem] flex-1 flex-col px-12 pt-5">
        <FieldRow label="From">
          <p className="truncate py-2 text-[14px] text-ink-muted">
            {account.senderName ? `${account.senderName} <${account.email}>` : account.email}
          </p>
        </FieldRow>
        {recipientRow('to')}
        {showCopies && recipientRow('cc')}
        {showCopies && recipientRow('bcc')}
        <FieldRow label="Subject">
          <input
            ref={(el) => {
              fields.current.subject = el ?? undefined
            }}
            type="text"
            value={draft.subject}
            readOnly={sending}
            onChange={(e) => update({ subject: e.target.value })}
            aria-label="Subject"
            className="min-w-0 flex-1 bg-transparent py-2 text-[14px] font-semibold outline-none"
          />
        </FieldRow>

        {(draft.attachments.length > 0 || attachError) && (
          <div className="border-b border-line py-2.5">
            {draft.attachments.length > 0 && (
              <ul aria-label="Attachments" className="flex flex-wrap gap-2">
                {draft.attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md bg-ink/5 pr-1 pl-2.5 text-[12.5px]"
                  >
                    <Paperclip
                      className="size-3.5 shrink-0 text-ink-muted"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="truncate" title={a.filename}>
                      {a.filename}
                    </span>
                    <span className="shrink-0 text-ink-faint tabular-nums">
                      {formatFileSize(a.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      aria-label={`Remove ${a.filename}`}
                      title="Remove"
                      className="grid size-5 shrink-0 place-items-center rounded text-ink-muted hover:bg-ink/8 hover:text-ink"
                    >
                      <X className="size-3.5" strokeWidth={2} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {attachError && (
              <p role="alert" className="mt-1.5 text-[12.5px] text-danger">
                {attachError}
              </p>
            )}
          </div>
        )}

        <textarea
          ref={(el) => {
            fields.current.body = el ?? undefined
          }}
          value={draft.body}
          readOnly={sending}
          onChange={(e) => update({ body: e.target.value })}
          aria-label="Message"
          className="selectable min-h-0 flex-1 resize-none bg-transparent pt-5 pb-16 font-serif text-[16.5px] leading-[1.65] outline-none"
        />
      </div>

      <DiscardDraftDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onDiscard={() => {
          setConfirming(false)
          discard()
        }}
      />
    </section>
  )
}

function FieldRow({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-line focus-within:border-accent">
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-[12.5px] text-ink-muted">{label}</span>
        {children}
      </div>
      {error && (
        <p role="alert" className="pb-2 pl-[4.25rem] text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** Tells the main process to forget attachment tokens that are no longer needed. */
function release(ids: string[]) {
  if (ids.length > 0) void api.compose.releaseAttachments(ids).catch(() => undefined)
}
