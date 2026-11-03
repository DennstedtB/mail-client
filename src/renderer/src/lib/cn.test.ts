import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('keeps the last of two conflicting Tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-ink', 'text-accent')).toBe('text-accent')
  })

  it('drops falsy values and keeps unrelated classes', () => {
    const selected = false
    expect(cn('flex', selected && 'bg-accent', undefined, 'gap-2')).toBe('flex gap-2')
  })
})
