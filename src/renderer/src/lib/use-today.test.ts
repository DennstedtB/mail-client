import { describe, expect, it } from 'vitest'
import { isSameDay, msUntilNextMidnight } from './use-today'

const MINUTE = 60_000

describe('msUntilNextMidnight', () => {
  it('counts down to the start of the next day', () => {
    expect(msUntilNextMidnight(new Date(2026, 10, 3, 23, 30))).toBe(30 * MINUTE)
  })

  it('is a full day right at midnight', () => {
    expect(msUntilNextMidnight(new Date(2026, 10, 3, 0, 0))).toBe(24 * 60 * MINUTE)
  })

  it('rolls over the end of a month and a year', () => {
    expect(msUntilNextMidnight(new Date(2026, 10, 30, 23, 59))).toBe(MINUTE)
    expect(msUntilNextMidnight(new Date(2026, 11, 31, 23, 59))).toBe(MINUTE)
  })
})

describe('isSameDay', () => {
  it('compares calendar days, not times', () => {
    expect(isSameDay(new Date(2026, 10, 3, 0, 1), new Date(2026, 10, 3, 23, 59))).toBe(true)
    expect(isSameDay(new Date(2026, 10, 3, 23, 59), new Date(2026, 10, 4, 0, 1))).toBe(false)
    expect(isSameDay(new Date(2026, 10, 3), new Date(2025, 10, 3))).toBe(false)
  })
})
