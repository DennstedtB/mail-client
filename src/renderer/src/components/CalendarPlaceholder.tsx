import { cn } from '../lib/cn'

/** Monday-first grid of the given month, padded with the neighbouring days. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7 // Monday = 0
  const start = new Date(year, month, 1 - offset)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weeks = Math.ceil((offset + daysInMonth) / 7)
  return Array.from(
    { length: weeks * 7 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  )
}

/**
 * Stand-in until M5. Shows the current month so the view has its real shape,
 * and says plainly that no calendars are connected yet.
 */
export function CalendarPlaceholder({ now = new Date() }: { now?: Date }) {
  const days = monthGrid(now.getFullYear(), now.getMonth())
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    now,
  )
  const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

  return (
    <section aria-label="Calendar" className="flex min-w-0 flex-1 flex-col bg-paper">
      <header className="drag-region flex h-[52px] shrink-0 items-center border-b border-line px-6">
        <h1 className="font-serif text-[20px] font-semibold">{monthLabel}</h1>
      </header>

      <div className="border-b border-line bg-surface px-6 py-3 text-[12.5px] text-ink-muted">
        No calendars connected. Day, week and month views for CalDAV calendars arrive in M5,
        Microsoft 365 calendars in M6.
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto] auto-rows-fr">
        {days.slice(0, 7).map((day) => (
          <div
            key={`h-${day.toISOString()}`}
            className="border-b border-line px-3 py-2 text-[11.5px] font-medium text-ink-muted"
          >
            {weekdayFormat.format(day)}
          </div>
        ))}
        {days.map((day) => {
          const inMonth = day.getMonth() === now.getMonth()
          const isToday = day.toDateString() === now.toDateString()
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'border-r border-b border-line px-2 py-1.5 [&:nth-child(7n)]:border-r-0',
                !inMonth && 'bg-surface/60',
              )}
            >
              <span
                className={cn(
                  'inline-grid size-6 place-items-center rounded-full text-[12px] tabular-nums',
                  inMonth ? 'text-ink' : 'text-ink-faint',
                  isToday && 'bg-accent font-semibold text-accent-contrast',
                )}
              >
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
