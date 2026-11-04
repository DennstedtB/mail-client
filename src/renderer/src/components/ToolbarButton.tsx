import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'

interface ToolbarButtonProps {
  icon: LucideIcon
  label: string
  /** Shown as a tooltip when the action isn't available yet, e.g. "Coming in M3". */
  unavailableReason?: string
  /** For toggles such as Flag: shown as active, announced as pressed. */
  pressed?: boolean
  onClick?: () => void
}

/**
 * Icon button for pane toolbars. Unavailable actions stay visible but inert,
 * with a tooltip saying when they arrive.
 */
export function ToolbarButton({
  icon: Icon,
  label,
  unavailableReason,
  pressed,
  onClick,
}: ToolbarButtonProps) {
  const unavailable = Boolean(unavailableReason)
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={unavailable || undefined}
      aria-pressed={pressed}
      title={unavailable ? `${label}: ${unavailableReason}` : label}
      onClick={unavailable ? undefined : onClick}
      className={cn(
        'no-drag grid size-8 place-items-center rounded-md text-ink-muted',
        unavailable ? 'opacity-45' : 'hover:bg-ink/6 hover:text-ink active:bg-ink/10',
        pressed && 'text-accent hover:text-accent',
      )}
    >
      <Icon
        className="size-[17px]"
        strokeWidth={1.75}
        fill={pressed ? 'currentColor' : 'none'}
        aria-hidden
      />
    </button>
  )
}
