import { describe, expect, it } from 'vitest'
import {
  parseDate,
  parseSearch,
  searchTerms,
  SEARCH_OPERATORS,
  type SearchNode,
} from './search-query'

const now = new Date(2026, 10, 4, 15, 30) // Wed 4 Nov 2026, 15:30 local time
const parse = (input: string) => parseSearch(input, { now })
const local = (y: number, m: number, d = 1) => new Date(y, m - 1, d).toISOString()
const text = (value: string, field = 'any'): SearchNode => ({
  type: 'term',
  term: { kind: 'text', field, text: value } as never,
})

describe('parseSearch', () => {
  it('needs every plain word', () => {
    expect(parse('invoice march')).toEqual({
      node: { type: 'and', nodes: [text('invoice'), text('march')] },
      problems: [],
    })
    expect(parse('  invoice ').node).toEqual(text('invoice'))
  })

  it('keeps a quoted phrase together, also unclosed while typing', () => {
    expect(parse('"see attached" pdf').node).toEqual({
      type: 'and',
      nodes: [text('see attached'), text('pdf')],
    })
    expect(parse('"see att').node).toEqual(text('see att'))
  })

  it('has nothing to search for in an empty input or bare symbols', () => {
    expect(parse('')).toEqual({ node: null, problems: [] })
    expect(parse('  @ - "" ( ) ').node).toBeNull()
  })

  it('limits operator values to their field', () => {
    expect(parse('from:anna@example.org').node).toEqual(text('anna@example.org', 'from'))
    expect(parse('to:anna').node).toEqual(text('anna', 'to'))
    expect(parse('cc:anna').node).toEqual(text('anna', 'cc'))
    expect(parse('subject:invoice').node).toEqual(text('invoice', 'subject'))
    expect(parse('body:lunch').node).toEqual(text('lunch', 'body'))
    expect(parse('filename:pdf').node).toEqual(text('pdf', 'filename'))
    expect(parse('attachment:pdf').node).toEqual(text('pdf', 'filename'))
  })

  it('reads operator names in any case and quoted values', () => {
    expect(parse('From:"Anna Berg" invoice').node).toEqual({
      type: 'and',
      nodes: [text('Anna Berg', 'from'), text('invoice')],
    })
  })

  it('takes an operator without a value as nothing yet', () => {
    expect(parse('from:')).toEqual({ node: null, problems: [] })
    expect(parse('invoice from:').node).toEqual(text('invoice'))
    expect(parse('from:"').node).toBeNull()
  })

  it('takes unknown names with a colon as text', () => {
    expect(parse('Re: lunch').node).toEqual({ type: 'and', nodes: [text('Re:'), text('lunch')] })
    expect(parse('12:30').node).toEqual(text('12:30'))
    expect(parse('"from:anna"').node).toEqual(text('from:anna'))
  })

  it('leaves out what follows a minus', () => {
    expect(parse('-newsletter').node).toEqual({ type: 'not', node: text('newsletter') })
    expect(parse('invoice -from:anna').node).toEqual({
      type: 'and',
      nodes: [text('invoice'), { type: 'not', node: text('anna', 'from') }],
    })
    // A minus inside a word or on its own is just text.
    expect(parse('e-mail').node).toEqual(text('e-mail'))
    expect(parse('a - b').node).toEqual({ type: 'and', nodes: [text('a'), text('b')] })
  })

  it('reads OR (in capitals) more tightly than the implicit AND', () => {
    expect(parse('from:anna OR from:bob invoice').node).toEqual({
      type: 'and',
      nodes: [{ type: 'or', nodes: [text('anna', 'from'), text('bob', 'from')] }, text('invoice')],
    })
    expect(parse('cats or dogs').node).toEqual({
      type: 'and',
      nodes: [text('cats'), text('or'), text('dogs')],
    })
    expect(parse('a AND b').node).toEqual({ type: 'and', nodes: [text('a'), text('b')] })
  })

  it('groups with brackets and forgives missing or stray ones', () => {
    expect(parse('(from:anna OR from:bob) -is:read').node).toEqual({
      type: 'and',
      nodes: [
        { type: 'or', nodes: [text('anna', 'from'), text('bob', 'from')] },
        { type: 'not', node: { type: 'term', term: { kind: 'status', flag: 'read' } } },
      ],
    })
    expect(parse('(a OR b').node).toEqual({ type: 'or', nodes: [text('a'), text('b')] })
    expect(parse('a) b').node).toEqual({ type: 'and', nodes: [text('a'), text('b')] })
    expect(parse('OR a OR').node).toEqual(text('a'))
  })

  it('understands status words, their unique beginnings and aliases', () => {
    const flag = (input: string) => {
      const node = parse(input).node
      return node?.type === 'term' && node.term.kind === 'status' ? node.term.flag : node
    }
    expect(flag('is:unread')).toBe('unread')
    expect(flag('is:unr')).toBe('unread')
    expect(flag('is:READ')).toBe('read')
    expect(flag('is:starred')).toBe('flagged')
    expect(flag('is:answered')).toBe('replied')
    // "re" fits read and replied: not finished yet, no problem while typing.
    expect(parse('is:re')).toEqual({ node: null, problems: [] })
    expect(parse('is:soon')).toEqual({
      node: null,
      problems: ['is: can be unread, read, flagged or replied.'],
    })
  })

  it('finds messages with attachments', () => {
    expect(parse('has:attachment').node).toEqual({ type: 'term', term: { kind: 'attachment' } })
    expect(parse('has:att').node).toEqual({ type: 'term', term: { kind: 'attachment' } })
    expect(parse('has:pdf').problems).toEqual(['has: can be attachment.'])
  })

  it('turns dates into local time ranges', () => {
    const date = (input: string) => {
      const node = parse(input).node
      return node?.type === 'term' ? node.term : node
    }
    expect(date('after:2026-11-01')).toEqual({ kind: 'date', from: local(2026, 11, 1) })
    expect(date('since:4.11.2026')).toEqual({ kind: 'date', from: local(2026, 11, 4) })
    expect(date('before:2026-11')).toEqual({ kind: 'date', until: local(2026, 11) })
    expect(date('date:2026-10')).toEqual({
      kind: 'date',
      from: local(2026, 10),
      until: local(2026, 11),
    })
    expect(date('on:2026/2/28')).toEqual({
      kind: 'date',
      from: local(2026, 2, 28),
      until: local(2026, 3, 1),
    })
    expect(date('date:2025')).toEqual({ kind: 'date', from: local(2025, 1), until: local(2026, 1) })
    expect(date('date:yesterday')).toEqual({
      kind: 'date',
      from: local(2026, 11, 3),
      until: local(2026, 11, 4),
    })
  })

  it('reports dates that make no sense, but not ones still being typed', () => {
    expect(parse('before:soon').problems).toHaveLength(1)
    expect(parse('date:31.2.2026').problems).toHaveLength(1)
    expect(parse('date:2026-13').problems).toHaveLength(1)
    expect(parse('after:1969').problems).toHaveLength(1)
    for (const typing of ['after:2026-', 'after:2026-11-', 'after:4.', 'after:tod']) {
      expect(parse(typing)).toEqual({ node: null, problems: [] })
    }
  })

  it('counts time spans back from now', () => {
    const term = (input: string) => {
      const node = parse(input).node
      return node?.type === 'term' ? node.term : node
    }
    expect(term('newer_than:7d')).toEqual({
      kind: 'date',
      from: new Date(2026, 9, 28, 15, 30).toISOString(),
    })
    expect(term('older_than:2w')).toEqual({
      kind: 'date',
      until: new Date(2026, 9, 21, 15, 30).toISOString(),
    })
    expect(term('newer:6M')).toEqual({
      kind: 'date',
      from: new Date(2026, 4, 4, 15, 30).toISOString(),
    })
    expect(term('older:1y')).toEqual({
      kind: 'date',
      until: new Date(2025, 10, 4, 15, 30).toISOString(),
    })
    expect(parse('newer_than:7')).toEqual({ node: null, problems: [] })
    expect(parse('newer_than:week').problems).toHaveLength(1)
  })

  it('reads sizes', () => {
    const term = (input: string) => {
      const node = parse(input).node
      return node?.type === 'term' ? node.term : node
    }
    expect(term('larger:5M')).toEqual({ kind: 'size', larger: 5 * 1024 * 1024 })
    expect(term('bigger:1,5mb')).toEqual({ kind: 'size', larger: 1.5 * 1024 * 1024 })
    expect(term('smaller:100K')).toEqual({ kind: 'size', smaller: 100 * 1024 })
    expect(term('smaller:900')).toEqual({ kind: 'size', smaller: 900 })
    expect(parse('larger:huge').problems).toEqual(['larger: needs a size, like 500K or 5M.'])
  })

  it('names folders by role or name', () => {
    expect(parse('in:sent').node).toEqual({ type: 'term', term: { kind: 'folder', name: 'sent' } })
    expect(parse('folder:"Projects/Acme"').node).toEqual({
      type: 'term',
      term: { kind: 'folder', name: 'Projects/Acme' },
    })
  })

  it('reports each problem once and keeps the rest', () => {
    const parsed = parse('is:soon invoice is:never')
    expect(parsed.node).toEqual(text('invoice'))
    expect(parsed.problems).toEqual(['is: can be unread, read, flagged or replied.'])
  })
})

describe('parseDate', () => {
  it('reads a day without a year as this year', () => {
    expect(parseDate('4.11.', now)).toEqual({ start: local(2026, 11, 4), end: local(2026, 11, 5) })
  })

  it('crosses months and years at the end of a range', () => {
    expect(parseDate('31.12.2026', now)?.end).toBe(local(2027, 1, 1))
    expect(parseDate('2026-12', now)?.end).toBe(local(2027, 1, 1))
  })
})

describe('searchTerms', () => {
  it('lists every term, also under NOT and OR', () => {
    const { node } = parse('(in:sent OR in:archive) -in:trash invoice')
    expect(searchTerms(node).map((t) => t.kind)).toEqual(['folder', 'folder', 'folder', 'text'])
  })
})

describe('SEARCH_OPERATORS', () => {
  it('uses every name once, in lower case', () => {
    const names = SEARCH_OPERATORS.flatMap((op) => op.names)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toBe(name.toLowerCase())
  })

  it('has examples that parse without problems', () => {
    for (const op of SEARCH_OPERATORS) {
      const parsed = parse(op.example)
      expect(parsed.problems, op.example).toEqual([])
      expect(parsed.node, op.example).not.toBeNull()
      for (const value of op.values ?? []) {
        expect(parse(`${op.names[0]}:${value}`).problems, value).toEqual([])
      }
    }
  })
})
