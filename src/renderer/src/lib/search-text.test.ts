import { describe, expect, it } from 'vitest'
import { appendSearchTerm } from './search-text'

describe('appendSearchTerm', () => {
  it('starts an empty search with the term', () => {
    expect(appendSearchTerm('', 'from:')).toBe('from:')
    expect(appendSearchTerm('  ', 'is:unread')).toBe('is:unread ')
  })

  it('adds the term after what is there', () => {
    expect(appendSearchTerm('invoice', 'from:')).toBe('invoice from:')
    expect(appendSearchTerm('invoice  ', 'has:attachment')).toBe('invoice has:attachment ')
    expect(appendSearchTerm('from:anna', 'is:unread')).toBe('from:anna is:unread ')
  })

  it('completes a word that is still being typed', () => {
    expect(appendSearchTerm('fro', 'from:')).toBe('from:')
    expect(appendSearchTerm('invoice is:', 'is:unread')).toBe('invoice is:unread ')
    expect(appendSearchTerm('invoice IS:UN', 'is:unread')).toBe('invoice is:unread ')
  })

  it('keeps a minus in front', () => {
    expect(appendSearchTerm('invoice -', 'from:')).toBe('invoice -from:')
    expect(appendSearchTerm('-is:r', 'is:read')).toBe('-is:read ')
  })
})
