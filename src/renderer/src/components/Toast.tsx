import { useEffect } from 'react'
import { CircleCheck, CircleAlert } from 'lucide-react'
import { cn } from '../lib/cn'

export interface ToastMessage {
  /** Changes with every new toast, so the same text shown twice restarts the timer. */
  id: number
  text: string
  tone: 'done' | 'problem'
}

/** A short confirmation at the bottom of the window, e.g. "Message sent". */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onDone, toast.tone === 'problem' ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [toast, onDone])

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center"
    >
      {toast && (
        <p
          key={toast.id}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-line bg-paper px-3.5 py-2 text-[13px]',
            'shadow-[0_8px_24px_rgba(0,0,0,0.16)]',
          )}
        >
          {toast.tone === 'done' ? (
            <CircleCheck className="size-4 text-accent" strokeWidth={2} aria-hidden />
          ) : (
            <CircleAlert className="size-4 text-danger" strokeWidth={2} aria-hidden />
          )}
          {toast.text}
        </p>
      )}
    </div>
  )
}
