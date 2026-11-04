/**
 * The search language. The UI uses it for instant hints and the search help;
 * the main process parses again and turns the result into SQL over the local
 * cache (src/main/cache/search-sql.ts).
 *
 * Syntax, in the spirit of Gmail and Outlook:
 *
 *   rech invoice      every word must match somewhere, as a prefix ("rech" finds "Rechnung")
 *   "exact phrase"    these words in this order
 *   from:anna         an operator limits a term to one field or property
 *   from:"Anna Berg"  quotes keep a value with spaces together
 *   -word -is:read    leaves out what matches
 *   a OR b            either one (OR in capitals, as in Gmail)
 *   (a OR b) c        groups
 *
 * The parser is lenient, because search runs as the user types: an operator
 * without a value ("from:") or an unclosed quote or bracket is simply taken
 * as far as it goes. Only values that make no sense ("before:soon") are
 * reported as problems, and a search with problems doesn't run.
 *
 * To add an operator, e.g. `tag:` once messages have tags:
 * 1. add a term kind to `SearchTerm`,
 * 2. add an entry to `SEARCH_OPERATORS` that turns the value into that term
 *    (it shows up in the search help by itself),
 * 3. add its SQL in src/main/cache/search-sql.ts; the type check fails until
 *    every term kind has one.
 */

import type { FolderRole } from './types/mail'

/** Where a text term looks. `any` is every field at once. */
export type TextField = 'any' | 'subject' | 'from' | 'to' | 'cc' | 'body' | 'filename'

export type StatusFlag = 'unread' | 'read' | 'flagged' | 'replied'

export type SearchTerm =
  /** Words or a phrase; every word matches as a prefix. */
  | { kind: 'text'; field: TextField; text: string }
  | { kind: 'status'; flag: StatusFlag }
  | { kind: 'attachment' }
  /** A time range, ISO 8601: `from` inclusive, `until` exclusive. */
  | { kind: 'date'; from?: string; until?: string }
  /** Message size in bytes. */
  | { kind: 'size'; larger?: number; smaller?: number }
  /** A folder by role ("sent") or name; the main process knows the folders. */
  | { kind: 'folder'; name: string }

export type SearchNode =
  | { type: 'term'; term: SearchTerm }
  | { type: 'not'; node: SearchNode }
  | { type: 'and'; nodes: SearchNode[] }
  | { type: 'or'; nodes: SearchNode[] }

export interface ParsedSearch {
  /** What to look for; null when the input holds nothing to search for yet, e.g. "from:". */
  node: SearchNode | null
  /** Values that make no sense, e.g. "before:soon". The search runs only without problems. */
  problems: string[]
}

export interface ParseOptions {
  /** Reference time for "today" and newer_than:; defaults to now. */
  now?: Date
}

/** What an operator's value turned into: a term, a problem to show, or nothing (empty value). */
export type OperatorResult = SearchTerm | { problem: string } | null

export interface SearchOperator {
  /** Typed before the colon. The first is the main name, shown in the help; the others work too. */
  names: readonly [string, ...string[]]
  /** For the search help. */
  example: string
  description: string
  /** The usual values, offered in the search help (and later for completion, e.g. tag names). */
  values?: readonly string[]
  parse(value: string, now: Date): OperatorResult
}

// --- Operators -------------------------------------------------------------

const DATE_FORMATS = '2026-11-04, 2026-11, 2026, 4.11.2026, 4.11., today or yesterday'

/** Folder roles that in: understands besides folder names. */
export const FOLDER_ROLE_WORDS: Record<string, Exclude<FolderRole, 'custom'>> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  archive: 'archive',
  junk: 'junk',
  spam: 'junk',
  trash: 'trash',
}

export const SEARCH_OPERATORS: readonly SearchOperator[] = [
  {
    names: ['from'],
    example: 'from:anna',
    description: 'Sender, by name or address. from:@example.org finds a whole domain.',
    parse: (value) => text('from', value),
  },
  {
    names: ['to'],
    example: 'to:anna@example.org',
    description: 'Anyone the message went to, in To or Cc.',
    parse: (value) => text('to', value),
  },
  {
    names: ['cc'],
    example: 'cc:anna',
    description: 'Anyone in Cc.',
    parse: (value) => text('cc', value),
  },
  {
    names: ['subject'],
    example: 'subject:invoice',
    description: 'Words in the subject.',
    parse: (value) => text('subject', value),
  },
  {
    names: ['body'],
    example: 'body:"see attached"',
    description: 'Words in the message text.',
    parse: (value) => text('body', value),
  },
  {
    names: ['filename', 'attachment'],
    example: 'filename:pdf',
    description: 'Names of attachments.',
    parse: (value) => text('filename', value),
  },
  {
    names: ['in', 'folder'],
    example: 'in:sent',
    description: "A folder: inbox, sent, drafts, archive, junk, trash, or the folder's name.",
    values: ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'],
    parse: (value) => (value ? { kind: 'folder', name: value } : null),
  },
  {
    names: ['is'],
    example: 'is:unread',
    description: 'Status: unread, read, flagged or replied.',
    values: ['unread', 'read', 'flagged', 'replied'],
    parse: (value) =>
      choice(value, STATUS_WORDS, 'is: can be unread, read, flagged or replied.', (flag) => ({
        kind: 'status',
        flag,
      })),
  },
  {
    names: ['has'],
    example: 'has:attachment',
    description: 'Messages with attachments.',
    values: ['attachment'],
    parse: (value) =>
      choice(value, { attachment: true, attachments: true }, 'has: can be attachment.', () => ({
        kind: 'attachment',
      })),
  },
  {
    names: ['after', 'since'],
    example: 'after:2026-11-01',
    description: `On or after a date: ${DATE_FORMATS}.`,
    parse: (value, now) => dateTerm('after', value, now, (r) => ({ from: r.start })),
  },
  {
    names: ['before'],
    example: 'before:2026-11',
    description: 'Before a date (that day, month or year left out).',
    parse: (value, now) => dateTerm('before', value, now, (r) => ({ until: r.start })),
  },
  {
    names: ['date', 'on'],
    example: 'date:2026-10',
    description: 'On a day, in a month or in a year.',
    parse: (value, now) => dateTerm('date', value, now, (r) => ({ from: r.start, until: r.end })),
  },
  {
    names: ['newer_than', 'newer'],
    example: 'newer_than:7d',
    description: 'Newer than a time span: days (d), weeks (w), months (m) or years (y).',
    parse: (value, now) => ageTerm('newer_than', value, now, (at) => ({ from: at })),
  },
  {
    names: ['older_than', 'older'],
    example: 'older_than:1y',
    description: 'Older than a time span.',
    parse: (value, now) => ageTerm('older_than', value, now, (at) => ({ until: at })),
  },
  {
    names: ['larger', 'bigger'],
    example: 'larger:5M',
    description: 'Larger than a size, attachments included: 500K, 5M.',
    parse: (value) => sizeTerm('larger', value, (bytes) => ({ larger: bytes })),
  },
  {
    names: ['smaller'],
    example: 'smaller:100K',
    description: 'Smaller than a size.',
    parse: (value) => sizeTerm('smaller', value, (bytes) => ({ smaller: bytes })),
  },
]

/** The ways to combine terms, for the search help. */
export const SEARCH_SYNTAX: readonly { example: string; description: string }[] = [
  { example: 'invoice march', description: 'Every word must match, anywhere.' },
  { example: '"exact phrase"', description: 'These words in this order.' },
  { example: '-word', description: 'Leaves out messages that match. Works with operators too.' },
  { example: 'a OR b', description: 'Either one.' },
  { example: '(a OR b) c', description: 'Brackets group terms.' },
]

const OPERATORS_BY_NAME = new Map(
  SEARCH_OPERATORS.flatMap((op) => op.names.map((name) => [name, op] as const)),
)

const STATUS_WORDS: Record<string, StatusFlag> = {
  unread: 'unread',
  read: 'read',
  flagged: 'flagged',
  starred: 'flagged',
  replied: 'replied',
  answered: 'replied',
}

/** True if the value has something a search can match: a letter or a digit. */
function searchable(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value)
}

function text(field: TextField, value: string): OperatorResult {
  return searchable(value) ? { kind: 'text', field, text: value } : null
}

/**
 * A word from a fixed list. A unique beginning is enough ("is:unr"). One that
 * fits several words ("is:re") isn't finished yet: it counts as no value
 * rather than a problem, so typing doesn't flash a problem on the way.
 */
function choice<T>(
  value: string,
  words: Record<string, T>,
  problem: string,
  toTerm: (meaning: T) => SearchTerm,
): OperatorResult {
  if (!value) return null
  const typed = value.toLowerCase()
  if (Object.hasOwn(words, typed)) return toTerm(words[typed] as T)
  const meanings = new Set(
    Object.entries(words)
      .filter(([word]) => word.startsWith(typed))
      .map(([, meaning]) => meaning),
  )
  const [only] = meanings
  if (meanings.size === 1) return toTerm(only as T)
  return meanings.size > 1 ? null : { problem }
}

/** True for the start of a date that isn't complete yet: "2026-", "2026-11-", "tod". */
function unfinishedDate(value: string): boolean {
  const word = value.toLowerCase()
  return /^[\d./-]*[-/.]$/.test(value) || ['today', 'yesterday'].some((w) => w.startsWith(word))
}

interface DayRange {
  /** ISO 8601, inclusive */
  start: string
  /** ISO 8601, exclusive */
  end: string
}

function dateTerm(
  name: string,
  value: string,
  now: Date,
  toRange: (range: DayRange) => { from?: string; until?: string },
): OperatorResult {
  if (!value) return null
  const range = parseDate(value, now)
  if (range) return { kind: 'date', ...toRange(range) }
  if (unfinishedDate(value)) return null
  return { problem: `${name}: needs a date, like ${DATE_FORMATS}.` }
}

/**
 * A day, month or year in local time, as the range it covers. Accepts
 * 2026-11-04, 2026/11/04, 2026-11, 2026, 4.11.2026, 4.11. (this year),
 * today and yesterday.
 */
export function parseDate(value: string, now: Date = new Date()): DayRange | null {
  const word = value.toLowerCase()
  if (word === 'today' || word === 'yesterday') {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (word === 'yesterday') day.setDate(day.getDate() - 1)
    return range(day.getFullYear(), day.getMonth() + 1, day.getDate())
  }
  const iso = /^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/.exec(value)
  if (iso) return range(Number(iso[1]), optional(iso[2]), optional(iso[3]))
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(value)
  if (german) {
    const year = german[3] === undefined ? now.getFullYear() : Number(german[3])
    return range(year, Number(german[2]), Number(german[1]))
  }
  return null
}

function optional(digits: string | undefined): number | undefined {
  return digits === undefined ? undefined : Number(digits)
}

/** The local-time range of a year, a month or a day; null if there is no such date. */
function range(year: number, month?: number, day?: number): DayRange | null {
  if (year < 1970 || year > 9999) return null
  if (month !== undefined && (month < 1 || month > 12)) return null
  const start = new Date(year, (month ?? 1) - 1, day ?? 1)
  // new Date() rolls over (31 Feb → 3 Mar); such a date doesn't exist.
  if (day !== undefined && start.getDate() !== day) return null
  const end = new Date(start)
  if (day !== undefined) end.setDate(end.getDate() + 1)
  else if (month !== undefined) end.setMonth(end.getMonth() + 1)
  else end.setFullYear(end.getFullYear() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

function ageTerm(
  name: string,
  value: string,
  now: Date,
  toRange: (at: string) => { from?: string; until?: string },
): OperatorResult {
  if (!value || /^\d+$/.test(value)) return null // The unit is still to come.
  const match = /^(\d{1,4})([dwmy])$/i.exec(value)
  if (!match) return { problem: `${name}: needs a time span, like 3d, 2w, 6m or 1y.` }
  const amount = Number(match[1])
  const at = new Date(now)
  switch (match[2]!.toLowerCase()) {
    case 'd':
      at.setDate(at.getDate() - amount)
      break
    case 'w':
      at.setDate(at.getDate() - 7 * amount)
      break
    case 'm':
      at.setMonth(at.getMonth() - amount)
      break
    default:
      at.setFullYear(at.getFullYear() - amount)
  }
  return { kind: 'date', ...toRange(at.toISOString()) }
}

const SIZE_UNITS: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }

function sizeTerm(
  name: string,
  value: string,
  toTerm: (bytes: number) => { larger?: number; smaller?: number },
): OperatorResult {
  if (!value) return null
  const match = /^(\d+(?:[.,]\d+)?)([kmg]?)b?$/i.exec(value)
  if (!match) return { problem: `${name}: needs a size, like 500K or 5M.` }
  const bytes = Number(match[1]!.replace(',', '.')) * SIZE_UNITS[match[2]!.toLowerCase()]!
  return { kind: 'size', ...toTerm(Math.round(bytes)) }
}

// --- Parsing ---------------------------------------------------------------

type Token =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'or' }
  | { type: 'not' }
  | { type: 'word'; operator?: SearchOperator; value: string }

/** Reads a quoted value starting at the quote; an unclosed one runs to the end. */
function readQuoted(input: string, quote: number): [value: string, next: number] {
  const close = input.indexOf('"', quote + 1)
  return close === -1
    ? [input.slice(quote + 1), input.length]
    : [input.slice(quote + 1, close), close + 1]
}

function scan(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const char = input[i]!
    if (/\s/.test(char)) {
      i++
    } else if (char === '(') {
      tokens.push({ type: 'open' })
      i++
    } else if (char === ')') {
      tokens.push({ type: 'close' })
      i++
    } else if (char === '-' && i + 1 < input.length && !/[\s)]/.test(input[i + 1]!)) {
      tokens.push({ type: 'not' })
      i++
    } else if (char === '"') {
      const [value, next] = readQuoted(input, i)
      tokens.push({ type: 'word', value })
      i = next
    } else {
      let end = i
      while (end < input.length && !/[\s()"]/.test(input[end]!)) end++
      const chunk = input.slice(i, end)
      i = end
      const colon = chunk.indexOf(':')
      const name = colon > 0 ? chunk.slice(0, colon).toLowerCase() : ''
      const operator = OPERATORS_BY_NAME.get(name)
      if (operator) {
        // from:"Anna Berg": the quoted value right after the colon belongs to the operator.
        if (colon === chunk.length - 1 && input[i] === '"') {
          const [value, next] = readQuoted(input, i)
          tokens.push({ type: 'word', operator, value })
          i = next
        } else {
          tokens.push({ type: 'word', operator, value: chunk.slice(colon + 1) })
        }
      } else if (chunk === 'OR') {
        tokens.push({ type: 'or' })
      } else if (chunk !== 'AND') {
        // Includes unknown "name:" chunks such as "Re:" or "12:30": they are just text.
        tokens.push({ type: 'word', value: chunk })
      }
    }
  }
  return tokens
}

function combine(type: 'and' | 'or', nodes: SearchNode[]): SearchNode | null {
  if (nodes.length === 0) return null
  if (nodes.length === 1) return nodes[0]!
  return { type, nodes }
}

/** Parses what the user typed into the search field. Never throws. */
export function parseSearch(input: string, options: ParseOptions = {}): ParsedSearch {
  const now = options.now ?? new Date()
  const tokens = scan(input)
  const problems: string[] = []
  let position = 0
  let depth = 0

  // sequence := alternatives*   (implicit AND)
  function sequence(): SearchNode[] {
    const nodes: SearchNode[] = []
    while (position < tokens.length) {
      if (tokens[position]!.type === 'close') {
        if (depth > 0) break
        position++ // A stray ")" at the top level.
        continue
      }
      const node = alternatives()
      if (node) nodes.push(node)
    }
    return nodes
  }

  // alternatives := unary ("OR" unary)*
  function alternatives(): SearchNode | null {
    const options: SearchNode[] = []
    const first = unary()
    if (first) options.push(first)
    while (tokens[position]?.type === 'or') {
      position++
      const next = unary()
      if (next) options.push(next)
    }
    return combine('or', options)
  }

  // unary := "-" unary | "(" sequence ")" | word
  function unary(): SearchNode | null {
    const token = tokens[position]
    if (!token || token.type === 'close') return null
    position++
    switch (token.type) {
      case 'not': {
        const inner = unary()
        return inner && { type: 'not', node: inner }
      }
      case 'open': {
        depth++
        const nodes = sequence()
        depth--
        if (tokens[position]?.type === 'close') position++
        return combine('and', nodes)
      }
      case 'or':
        return null // An OR with nothing before it.
      case 'word':
        return word(token)
    }
  }

  function word(token: Extract<Token, { type: 'word' }>): SearchNode | null {
    const value = token.value.trim()
    if (!token.operator) {
      return searchable(value)
        ? { type: 'term', term: { kind: 'text', field: 'any', text: value } }
        : null
    }
    const result = token.operator.parse(value, now)
    if (result === null) return null
    if ('problem' in result) {
      if (!problems.includes(result.problem)) problems.push(result.problem)
      return null
    }
    return { type: 'term', term: result }
  }

  return { node: combine('and', sequence()), problems }
}

/** Every term in a parsed search, e.g. to find the folders it names. */
export function searchTerms(node: SearchNode | null): SearchTerm[] {
  if (!node) return []
  switch (node.type) {
    case 'term':
      return [node.term]
    case 'not':
      return searchTerms(node.node)
    case 'and':
    case 'or':
      return node.nodes.flatMap(searchTerms)
  }
}
