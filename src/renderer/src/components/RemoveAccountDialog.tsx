import { useId, useState } from 'react'
import type { Account } from '@shared/types/mail'
import { errorMessage } from '../lib/errors'
import { Modal } from './Modal'

const api = window.api

interface RemoveAccountDialogProps {
  account: Account | null
  onClose: () => void
  onRemoved: (account: Account) => void
}

export function RemoveAccountDialog({ account, onClose, onRemoved }: RemoveAccountDialogProps) {
  const titleId = useId()
  return (
    <Modal open={account !== null} onClose={onClose} labelledBy={titleId} className="w-[26rem]">
      {account && (
        <RemoveAccountBody
          account={account}
          titleId={titleId}
          onClose={onClose}
          onRemoved={onRemoved}
        />
      )}
    </Modal>
  )
}

function RemoveAccountBody({
  account,
  titleId,
  onClose,
  onRemoved,
}: {
  account: Account
  titleId: string
  onClose: () => void
  onRemoved: (account: Account) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.accounts.remove(account.id)
      onRemoved(account)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="px-6 pt-5 pb-4">
        <h2 id={titleId} className="font-serif text-[18px] font-semibold">
          Remove “{account.name}”?
        </h2>
        <p className="mt-2 text-[13px] text-ink-muted">
          MailClient forgets {account.email} and deletes its stored password. Your mail on the
          server isn't touched.
        </p>
        {error && (
          <p role="alert" className="mt-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t border-line bg-surface px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          autoFocus
          className="h-8 rounded-md px-3 text-[13px] font-medium hover:bg-ink/6"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          aria-disabled={busy || undefined}
          className="h-8 rounded-md bg-danger px-3.5 text-[13px] font-semibold text-white hover:brightness-110"
        >
          {busy ? 'Removing…' : 'Remove account'}
        </button>
      </footer>
    </div>
  )
}
