import { useId } from 'react'
import { Modal } from './Modal'

interface DiscardDraftDialogProps {
  open: boolean
  onCancel: () => void
  onDiscard: () => void
}

/** Asked before a changed draft is thrown away. Drafts aren't saved yet. */
export function DiscardDraftDialog({ open, onCancel, onDiscard }: DiscardDraftDialogProps) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onCancel} labelledBy={titleId} className="w-[24rem]">
      <div className="px-6 pt-5 pb-4">
        <h2 id={titleId} className="font-serif text-[18px] font-semibold">
          Discard this message?
        </h2>
        <p className="mt-2 text-[13px] text-ink-muted">
          What you wrote will be lost. Saving drafts comes in a later milestone.
        </p>
      </div>
      <footer className="flex justify-end gap-2 border-t border-line bg-surface px-6 py-3">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="h-8 rounded-md px-3 text-[13px] font-medium hover:bg-ink/6"
        >
          Keep writing
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="h-8 rounded-md bg-danger px-3.5 text-[13px] font-semibold text-danger-contrast hover:brightness-110"
        >
          Discard
        </button>
      </footer>
    </Modal>
  )
}
