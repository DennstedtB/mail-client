import type { Address } from '@shared/types/mail'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Compact date for the message list:
 * today → time, yesterday → "Yesterday", within a week → weekday,
 * this year → day and month, older → full date.
 */
export function formatListDate(iso: string, now: Date = new Date(), locale?: string): string {
  const date = new Date(iso)
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS)

  if (dayDiff <= 0) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)
}

/** Full date and time for the reading pane header. */
export function formatFullDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Name if there is one, otherwise the address. */
export function displayName(address: Address): string {
  return address.name?.trim() || address.email
}

/** Up to two initials for an avatar: "Lena Hoffmann" → "LH", "jonas@example.net" → "J". */
export function initials(address: Address): string {
  const name = address.name?.trim()
  if (!name) return (address.email[0] ?? '?').toUpperCase()
  const words = name.split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** Human-readable file size: 482133 → "471 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
