import { describe, expect, it } from 'vitest'
import { monthGrid } from './CalendarPlaceholder'

describe('monthGrid', () => {
  it('starts on a Monday and covers whole weeks', () => {
    const days = monthGrid(2026, 10) // November 2026 starts on a Sunday
    expect(days.length % 7).toBe(0)
    expect(days[0]!.getDay()).toBe(1)
    expect(days[0]!.getDate()).toBe(26) // Monday 26 October
    expect(days.at(-1)!.getDay()).toBe(0)
  })

  it('contains every day of the month exactly once', () => {
    const days = monthGrid(2026, 1).filter((d) => d.getMonth() === 1) // February 2026
    expect(days.map((d) => d.getDate())).toEqual(Array.from({ length: 28 }, (_, i) => i + 1))
  })

  it('includes February 29 in a leap year whose February starts on a Monday', () => {
    // February 2016: no padding before the 1st, so the 29th only appears if it is counted.
    const days = monthGrid(2016, 1).filter((d) => d.getMonth() === 1)
    expect(days.map((d) => d.getDate())).toEqual(Array.from({ length: 29 }, (_, i) => i + 1))
  })
})
