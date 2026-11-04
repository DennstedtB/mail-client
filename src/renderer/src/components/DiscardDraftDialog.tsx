import { ConfirmDialog } from './ConfirmDialog'

interface DiscardDraftDialogProps {
  open: boolean
  onCancel: () => void
  onDiscard: () => void
}

/** Asked before a changed draft is thrown away. Drafts aren't saved yet. */
export function DiscardDraftDialog({ open, onCancel, onDiscard }: DiscardDraftDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Discard this message?"
      text="What you wrote will be lost. Saving drafts comes in a later milestone."
      confirmLabel="Discard"
      cancelLabel="Keep writing"
      onCancel={onCancel}
      onConfirm={onDiscard}
    />
  )
}
