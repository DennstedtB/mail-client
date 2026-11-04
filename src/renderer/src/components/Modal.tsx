import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../lib/cn'

interface ModalProps {
  open: boolean
  /** Called when the dialog closes: Escape, Cancel, or the parent setting `open` to false. */
  onClose: () => void
  /** Id of the element that names the dialog, usually its heading. */
  labelledBy: string
  /** While true, Escape doesn't close the dialog (e.g. during a running operation). */
  preventClose?: boolean
  className?: string
  children: ReactNode
}

/**
 * A native modal <dialog>: the browser traps focus, makes the rest of the
 * window inert, and closes it on Escape.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  preventClose = false,
  className,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(event) => {
        if (preventClose) event.preventDefault()
      }}
      className={cn(
        'm-auto max-h-[88vh] w-[34rem] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink',
        'shadow-[0_24px_64px_rgba(0,0,0,0.28)] backdrop:bg-black/30',
        className,
      )}
    >
      {open && children}
    </dialog>
  )
}
