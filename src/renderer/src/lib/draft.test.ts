import { describe, expect, it } from 'vitest'
import type { Draft } from '@shared/types/compose'
import { composeTitle, initialFocus, isDraftChanged } from './draft'

const base: Draft = {
  kind: 'reply',
  accountId: 'a1',
  to: 'bob@example.org',
  cc: '',
  bcc: '',
  subject: 'Re: Lunch',
  body: '\n\nOn …, Bob wrote:\n> Hi',
  attachments: [{ id: 't1', filename: 'a.pdf', size: 1 }],
}

describe('draft helpers', () => {
  it('sees edits to fields and attachments, not an untouched draft', () => {
    expect(isDraftChanged(base, { ...base })).toBe(false)
    expect(isDraftChanged(base, { ...base, body: `Sure!${base.body}` })).toBe(true)
    expect(isDraftChanged(base, { ...base, attachments: [] })).toBe(true)
  })

  it('starts replies in the body and everything else in To', () => {
    expect(initialFocus(base)).toBe('body')
    expect(initialFocus({ ...base, kind: 'forward' })).toBe('to')
  })

  it('names the pane after the subject, or what is being written', () => {
    expect(composeTitle(base)).toBe('Re: Lunch')
    expect(composeTitle({ ...base, kind: 'new', subject: ' ' })).toBe('New message')
  })
})
