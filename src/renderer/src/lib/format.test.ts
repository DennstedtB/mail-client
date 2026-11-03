import { describe, expect, it } from 'vitest'
import { displayName, formatFileSize, formatListDate, initials } from './format'

// Local-time dates, so the tests hold in any time zone.
const NOW = new Date(2026, 10, 3, 9, 30) // Tue 3 Nov 2026, 09:30
const at = (...args: [number, number, number, number?, number?]) =>
  new Date(args[0], args[1], args[2], args[3] ?? 12, args[4] ?? 0).toISOString()

describe('formatListDate', () => {
  it('shows the time for today', () => {
    expect(formatListDate(at(2026, 10, 3, 8, 5), NOW, 'en-GB')).toBe('08:05')
  })

  it('says Yesterday for yesterday', () => {
    expect(formatListDate(at(2026, 10, 2, 23, 59), NOW, 'en-GB')).toBe('Yesterday')
  })

  it('shows the weekday within the last week', () => {
    expect(formatListDate(at(2026, 9, 30), NOW, 'en-GB')).toBe('Friday')
  })

  it('shows day and month earlier this year', () => {
    expect(formatListDate(at(2026, 9, 16), NOW, 'en-GB')).toBe('16 Oct')
  })

  it('shows the full date for earlier years', () => {
    expect(formatListDate(at(2025, 11, 24), NOW, 'en-GB')).toBe('24/12/2025')
  })
})

describe('initials', () => {
  it('uses first and last name', () => {
    expect(initials({ name: 'Lena Maria Hoffmann', email: 'l@example.org' })).toBe('LH')
  })

  it('falls back to the address', () => {
    expect(initials({ email: 'jonas@example.net' })).toBe('J')
  })
})

describe('displayName', () => {
  it('prefers the name and falls back to the address', () => {
    expect(displayName({ name: 'Lena', email: 'l@example.org' })).toBe('Lena')
    expect(displayName({ name: '  ', email: 'l@example.org' })).toBe('l@example.org')
  })
})

describe('formatFileSize', () => {
  it('picks a readable unit', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(482_133)).toBe('471 KB')
    expect(formatFileSize(5_400_000)).toBe('5.1 MB')
  })
})
