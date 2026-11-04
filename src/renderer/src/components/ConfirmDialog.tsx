import { useId } from 'react'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  text: string
  /** The destructive action, e.g. "Delete". */
  confirmLabel: string
  cancelLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

/** Asks before something that can't be undone. Cancel has the focus. */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  cancelLabel = 'Cancel',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onCancel} labelledBy={titleId} className="w-[24rem]">
      <div className="px-6 pt-5 pb-4">
        <h2 id={titleId} className="font-serif text-[18px] font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-[13px] text-ink-muted">{text}</p>
      </div>
      <footer className="flex justify-end gap-2 border-t border-line bg-surface px-6 py-3">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="h-8 rounded-md px-3 text-[13px] font-medium hover:bg-ink/6"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-8 rounded-md bg-danger px-3.5 text-[13px] font-semibold text-danger-contrast hover:brightness-110"
        >
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  )
}
