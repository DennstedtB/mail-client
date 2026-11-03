import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import {
  hasErrors,
  isLoopbackHost,
  validateNewAccount,
  type AccountField,
} from '@shared/account-validation'
import type { CheckResult, ConnectionSecurity } from '@shared/types/account'
import type { Account } from '@shared/types/mail'
import {
  EMPTY_FORM,
  LOCAL_TEST_SERVER,
  portForSecurity,
  suggestedHosts,
  toAccountInput,
  type AccountForm,
} from '../lib/account-form'
import { cn } from '../lib/cn'
import { errorMessage } from '../lib/errors'
import { Modal } from './Modal'

const api = window.api

type Status =
  | { kind: 'editing' }
  | { kind: 'checking' }
  | { kind: 'failed'; imap: CheckResult; smtp: CheckResult }
  | { kind: 'error'; message: string }

interface AddAccountDialogProps {
  open: boolean
  onClose: () => void
  onAdded: (account: Account) => void
  /** Offers to fill in the local test server; only while developing. */
  showLocalPreset: boolean
}

export function AddAccountDialog({
  open,
  onClose,
  onAdded,
  showLocalPreset,
}: AddAccountDialogProps) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <AddAccountForm
        titleId={titleId}
        onCancel={onClose}
        onAdded={onAdded}
        showLocalPreset={showLocalPreset}
      />
    </Modal>
  )
}

function AddAccountForm({
  titleId,
  onCancel,
  onAdded,
  showLocalPreset,
}: {
  titleId: string
  onCancel: () => void
  onAdded: (account: Account) => void
  showLocalPreset: boolean
}) {
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)
  const [showErrors, setShowErrors] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'editing' })

  const input = toAccountInput(form)
  const errors = validateNewAccount(input)
  const visibleErrors = showErrors ? errors : {}
  const hosts = suggestedHosts(form.email)
  const localServer = isLoopbackHost(form.imapHost) || isLoopbackHost(form.smtpHost)
  const checking = status.kind === 'checking'

  function update(patch: Partial<AccountForm>) {
    setForm((current) => ({ ...current, ...patch }))
    if (status.kind !== 'checking') setStatus({ kind: 'editing' })
  }

  function setSecurity(protocol: 'imap' | 'smtp', security: ConnectionSecurity) {
    if (protocol === 'imap') {
      update({ imapSecurity: security, imapPort: portForSecurity('imap', form.imapPort, security) })
    } else {
      update({ smtpSecurity: security, smtpPort: portForSecurity('smtp', form.smtpPort, security) })
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (checking) return
    setShowErrors(true)
    if (hasErrors(errors)) {
      const first = Object.keys(errors)[0]
      document.getElementById(fieldId(titleId, first as AccountField))?.focus()
      return
    }
    setStatus({ kind: 'checking' })
    try {
      const result = await api.accounts.add(input)
      if (result.status === 'added') return onAdded(result.account)
      setStatus({ kind: 'failed', imap: result.imap, smtp: result.smtp })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
    // The result sits below the form; make sure it's visible.
    requestAnimationFrame(() =>
      document.getElementById(`${titleId}-status`)?.scrollIntoView({ block: 'nearest' }),
    )
  }

  const field = (name: AccountField) => ({
    id: fieldId(titleId, name),
    error: visibleErrors[name],
  })

  return (
    <form onSubmit={submit} noValidate className="flex max-h-[88vh] flex-col">
      <header className="px-6 pt-5 pb-3">
        <h2 id={titleId} className="font-serif text-[20px] font-semibold">
          Add account
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Enter the details from your mail provider. MailClient checks both servers before saving,
          and keeps the password in the macOS Keychain.
        </p>
        {showLocalPreset && (
          <button
            type="button"
            onClick={() => {
              update({ ...LOCAL_TEST_SERVER })
              document.getElementById(fieldId(titleId, 'password'))?.focus()
            }}
            className="mt-2 text-[12.5px] font-medium text-accent hover:underline"
          >
            Fill in the local test server
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-5">
        <fieldset className="grid grid-cols-2 gap-x-3 gap-y-3">
          <legend className="sr-only">Account</legend>
          <TextField
            label="Account name"
            hint="Shown in the sidebar"
            placeholder="Work"
            value={form.name}
            onChange={(name) => update({ name })}
            {...field('name')}
          />
          <TextField
            label="Your name"
            hint="Shown to recipients"
            placeholder="Alex Example"
            value={form.senderName}
            onChange={(senderName) => update({ senderName })}
            autoComplete="name"
            {...field('senderName')}
          />
          <TextField
            label="Email address"
            placeholder="you@example.com"
            value={form.email}
            onChange={(email) => update({ email })}
            type="email"
            autoComplete="email"
            {...field('email')}
          />
          <TextField
            label="Password"
            value={form.password}
            onChange={(password) => update({ password })}
            type="password"
            autoComplete="off"
            {...field('password')}
          />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold text-ink-muted">Servers</legend>
          <ServerRow
            label="Incoming mail (IMAP)"
            host={form.imapHost}
            port={form.imapPort}
            security={form.imapSecurity}
            hostPlaceholder={hosts.imap}
            onHost={(imapHost) => update({ imapHost })}
            onPort={(imapPort) => update({ imapPort })}
            onSecurity={(s) => setSecurity('imap', s)}
            hostField={field('imap.host')}
            portField={field('imap.port')}
          />
          <ServerRow
            label="Outgoing mail (SMTP)"
            host={form.smtpHost}
            port={form.smtpPort}
            security={form.smtpSecurity}
            hostPlaceholder={hosts.smtp}
            onHost={(smtpHost) => update({ smtpHost })}
            onPort={(smtpPort) => update({ smtpPort })}
            onSecurity={(s) => setSecurity('smtp', s)}
            hostField={field('smtp.host')}
            portField={field('smtp.port')}
          />
          <TextField
            label="User name"
            hint="Leave empty if it's your email address"
            placeholder={form.email.trim() || 'you@example.com'}
            value={form.username}
            onChange={(username) => update({ username })}
            autoComplete="off"
            {...field('username')}
          />
          {localServer && (
            <label className="flex items-start gap-2 text-[12.5px]">
              <input
                id={fieldId(titleId, 'acceptSelfSignedLocalCertificate')}
                type="checkbox"
                checked={form.acceptSelfSignedLocalCertificate}
                onChange={(e) => update({ acceptSelfSignedLocalCertificate: e.target.checked })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                Trust the self-signed certificate of this local server
                <span className="block text-ink-muted">
                  Only possible for servers on this Mac, such as the local test server.
                </span>
                {visibleErrors.acceptSelfSignedLocalCertificate && (
                  <span className="block text-danger">
                    {visibleErrors.acceptSelfSignedLocalCertificate}
                  </span>
                )}
              </span>
            </label>
          )}
        </fieldset>

        <StatusPanel id={`${titleId}-status`} status={status} />
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface px-6 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md px-3 text-[13px] font-medium text-ink hover:bg-ink/6"
        >
          Cancel
        </button>
        <button
          type="submit"
          aria-disabled={checking || undefined}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-accent-contrast',
            checking ? 'opacity-70' : 'hover:brightness-110',
          )}
        >
          {checking && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
          {checking ? 'Checking connection…' : 'Add account'}
        </button>
      </footer>
    </form>
  )
}

function fieldId(base: string, name: AccountField) {
  return `${base}-${name}`
}

const INPUT =
  'h-8 w-full rounded-md border bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/25'

function TextField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  autoComplete?: string
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={cn(INPUT, 'selectable', error ? 'border-danger' : 'border-line')}
      />
      <FieldNote id={id} hint={hint} error={error} />
    </div>
  )
}

function FieldNote({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  if (error) {
    return (
      <p id={`${id}-error`} className="mt-1 text-[11.5px] text-danger">
        {error}
      </p>
    )
  }
  if (hint) {
    return (
      <p id={`${id}-hint`} className="mt-1 text-[11.5px] text-ink-faint">
        {hint}
      </p>
    )
  }
  return null
}

function ServerRow(props: {
  label: string
  host: string
  port: string
  security: ConnectionSecurity
  hostPlaceholder: string
  onHost: (value: string) => void
  onPort: (value: string) => void
  onSecurity: (value: ConnectionSecurity) => void
  hostField: { id: string; error?: string }
  portField: { id: string; error?: string }
}) {
  const { hostField, portField } = props
  return (
    <div>
      <div className="grid grid-cols-[1fr_4.5rem_7rem] gap-2">
        <div className="min-w-0">
          <label htmlFor={hostField.id} className="mb-1 block text-[12px] font-medium">
            {props.label}
          </label>
          <input
            id={hostField.id}
            value={props.host}
            placeholder={props.hostPlaceholder}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={hostField.error ? true : undefined}
            aria-describedby={hostField.error ? `${hostField.id}-error` : undefined}
            onChange={(e) => props.onHost(e.target.value)}
            className={cn(INPUT, 'selectable', hostField.error ? 'border-danger' : 'border-line')}
          />
        </div>
        <div>
          <label htmlFor={portField.id} className="mb-1 block text-[12px] font-medium">
            Port
          </label>
          <input
            id={portField.id}
            value={props.port}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={portField.error ? true : undefined}
            aria-describedby={portField.error ? `${portField.id}-error` : undefined}
            onChange={(e) => props.onPort(e.target.value.replace(/[^\d]/g, ''))}
            className={cn(INPUT, 'tabular-nums', portField.error ? 'border-danger' : 'border-line')}
          />
        </div>
        <div>
          <label
            htmlFor={`${hostField.id}-security`}
            className="mb-1 block text-[12px] font-medium"
          >
            Security
          </label>
          <select
            id={`${hostField.id}-security`}
            value={props.security}
            onChange={(e) => props.onSecurity(e.target.value as ConnectionSecurity)}
            className={cn(INPUT, 'border-line pr-1')}
          >
            <option value="tls">TLS</option>
            <option value="starttls">STARTTLS</option>
          </select>
        </div>
      </div>
      <FieldNote id={hostField.id} error={hostField.error} />
      <FieldNote id={portField.id} error={portField.error} />
    </div>
  )
}

function StatusPanel({ id, status }: { id: string; status: Status }) {
  if (status.kind === 'failed') {
    return (
      <div id={id} role="alert" className="space-y-2 rounded-lg border border-line bg-surface p-3">
        <p className="text-[12.5px] font-medium">The account wasn't added.</p>
        <CheckRow label="Incoming mail (IMAP)" result={status.imap} />
        <CheckRow label="Outgoing mail (SMTP)" result={status.smtp} />
      </div>
    )
  }
  if (status.kind === 'error') {
    return (
      <p
        id={id}
        role="alert"
        className="rounded-lg border border-line bg-surface p-3 text-[12.5px] text-danger"
      >
        {status.message}
      </p>
    )
  }
  return null
}

function CheckRow({ label, result }: { label: string; result: CheckResult }): ReactNode {
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      {result.ok ? (
        <CircleCheck className="mt-px size-4 shrink-0 text-accent" aria-hidden />
      ) : (
        <CircleAlert className="mt-px size-4 shrink-0 text-danger" aria-hidden />
      )}
      <p>
        <span className="font-medium">{label}: </span>
        {result.ok ? 'connected' : result.message}
      </p>
    </div>
  )
}
