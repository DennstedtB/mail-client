import { describe, expect, it } from 'vitest'
import {
  forwardBlock,
  forwardSubject,
  formatRecipients,
  parseRecipients,
  quoteForReply,
  replyRecipients,
  replyReferences,
  replySubject,
} from './drafts'

describe('parseRecipients', () => {
  it('reads names, plain addresses and quoted names with commas', () => {
    expect(parseRecipients('Bob <bob@x.org>, carol@y.org; "Doe, J" <j@z.org>')).toEqual({
      ok: true,
      addresses: [
        { name: 'Bob', email: 'bob@x.org' },
        { email: 'carol@y.org' },
        { name: 'Doe, J', email: 'j@z.org' },
      ],
    })
  })

  it('reports what is not an address', () => {
    expect(parseRecipients('bob@x.org, not an address')).toEqual({
      ok: false,
      invalid: ['not an address'],
    })
    expect(parseRecipients('Bob <bob@>')).toEqual({ ok: false, invalid: ['Bob'] })
  })

  it('keeps semicolons inside quoted names, and splits on the others', () => {
    expect(parseRecipients('"Ops; Team" <ops@example.org>; bob@x.org')).toEqual({
      ok: true,
      addresses: [{ name: 'Ops; Team', email: 'ops@example.org' }, { email: 'bob@x.org' }],
    })
  })

  it('treats an empty field as no recipients', () => {
    expect(parseRecipients('  ')).toEqual({ ok: true, addresses: [] })
  })

  it('formats addresses back into a field, quoting names that need it', () => {
    expect(formatRecipients([{ name: 'Doe, J', email: 'j@z.org' }, { email: 'c@y.org' }])).toBe(
      '"Doe, J" <j@z.org>, c@y.org',
    )
    const roundTrip = parseRecipients(formatRecipients([{ name: 'Doe, J', email: 'j@z.org' }]))
    expect(roundTrip).toEqual({ ok: true, addresses: [{ name: 'Doe, J', email: 'j@z.org' }] })
  })
})

describe('subjects', () => {
  it('adds one Re: and removes earlier ones, also German AW:', () => {
    expect(replySubject('Lunch')).toBe('Re: Lunch')
    expect(replySubject('Re: RE: AW: Lunch')).toBe('Re: Lunch')
  })

  it('adds one Fwd: for forwards', () => {
    expect(forwardSubject('Re: Lunch')).toBe('Fwd: Lunch')
    expect(forwardSubject('WG: Fwd: Report')).toBe('Fwd: Report')
  })
})

describe('replyRecipients', () => {
  const source = {
    from: { name: 'Bob', email: 'bob@x.org' },
    replyTo: [],
    to: [{ email: 'alice@me.org' }, { email: 'carol@y.org' }],
    cc: [{ email: 'dave@z.org' }, { email: 'BOB@x.org' }],
  }

  it('replies to the sender, or to Reply-To when set', () => {
    expect(replyRecipients(source, 'alice@me.org', false)).toEqual({ to: [source.from], cc: [] })
    const withReplyTo = { ...source, replyTo: [{ email: 'team@x.org' }] }
    expect(replyRecipients(withReplyTo, 'alice@me.org', false).to).toEqual([
      { email: 'team@x.org' },
    ])
  })

  it('replies to all others in Cc, without me and without duplicates', () => {
    expect(replyRecipients(source, 'ALICE@me.org', true)).toEqual({
      to: [source.from],
      cc: [{ email: 'carol@y.org' }, { email: 'dave@z.org' }],
    })
  })

  it('replying to my own sent message goes to its recipients again', () => {
    const sent = { ...source, from: { email: 'alice@me.org' } }
    expect(replyRecipients(sent, 'alice@me.org', false).to).toEqual(source.to)
  })
})

describe('quoting', () => {
  it('quotes every line and says who wrote it', () => {
    const quoted = quoteForReply(
      'Hi\n> earlier',
      { name: 'Bob', email: 'bob@x.org' },
      '2026-11-04T09:30:00Z',
    )
    expect(quoted).toMatch(/On .*2026.*, Bob <bob@x.org> wrote:\n> Hi\n>> earlier\n$/)
  })

  it('puts the original headers above a forwarded message', () => {
    const block = forwardBlock('Body', {
      from: { email: 'bob@x.org' },
      to: [{ name: 'Alice', email: 'alice@me.org' }],
      cc: [],
      subject: 'Report',
      date: '2026-11-04T09:30:00Z',
    })
    expect(block).toContain('---------- Forwarded message ----------\nFrom: bob@x.org')
    expect(block).toContain('Subject: Report\nTo: Alice <alice@me.org>\n\nBody')
    expect(block).not.toContain('Cc:')
  })

  it('builds References from the original', () => {
    expect(replyReferences(['<a@x>'], '<b@x>')).toEqual(['<a@x>', '<b@x>'])
    expect(replyReferences(['<a@x>', '<b@x>'], '<b@x>')).toEqual(['<a@x>', '<b@x>'])
    expect(replyReferences([], undefined)).toEqual([])
  })
})
