import { useEffect, useState } from 'react'

/** Milliseconds from `now` until the next local midnight. */
export function msUntilNextMidnight(now: Date): number {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return nextMidnight.getTime() - now.getTime()
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * The current date, updated when the day changes: by a timer at local
 * midnight, and when the window regains focus or visibility (timers can fire
 * late after the Mac wakes from sleep). Components that show relative dates
 * ("Yesterday", today's highlight) use this so they never go stale.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    const refresh = () => {
      const now = new Date()
      if (!isSameDay(now, today)) setToday(now)
    }
    // One second past midnight, so the new day has definitely started.
    const timer = window.setTimeout(refresh, msUntilNextMidnight(new Date()) + 1000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [today])

  return today
}
