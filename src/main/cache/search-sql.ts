import type { SQLInputValue } from 'node:sqlite'
import {
  FOLDER_ROLE_WORDS,
  type SearchNode,
  type SearchTerm,
  type TextField,
} from '@shared/search-query'
import type { FolderId, FolderRole } from '@shared/types/mail'

/**
 * Turns a parsed search (src/shared/search-query.ts) into a WHERE condition
 * over the cache's `messages` table, which the query must call `m`.
 *
 * Text terms look in the FTS5 index `message_search`; everything else is a
 * column of `messages`. Every term becomes a condition of its own, so NOT,
 * AND and OR combine them freely, as SQL does.
 */

export interface SqlCondition {
  sql: string
  params: SQLInputValue[]
}

/** What search knows about a folder, kept in the cache's `folders` table. */
export interface SearchFolder {
  id: FolderId
  name: string
  role: FolderRole
}

export interface SearchContext {
  folders: SearchFolder[]
}

/** The FTS5 columns each field looks in; `any` looks in all of them. */
const TEXT_COLUMNS: Record<Exclude<TextField, 'any'>, readonly string[]> = {
  subject: ['subject'],
  from: ['sender'],
  to: ['to_list', 'cc_list'],
  cc: ['cc_list'],
  body: ['body'],
  filename: ['filenames'],
}

const NOTHING: SqlCondition = { sql: '0', params: [] }

/**
 * The FTS5 query for a text term: its words in this order, each as a prefix
 * ("anna.berg@ex" finds anna.berg@example.org). Words are split the way the
 * index splits them (letters and digits), so the query needs no escaping.
 */
export function ftsQuery(field: TextField, text: string): string | null {
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length === 0) return null
  const phrase = words.map((word) => `"${word}"*`).join(' + ')
  return field === 'any' ? phrase : `{${TEXT_COLUMNS[field].join(' ')}} : ${phrase}`
}

/** The folders that in:/folder: means: a role, or a folder's name or path; else names that start so. */
export function matchFolders(name: string, folders: SearchFolder[]): FolderId[] {
  const typed = name.toLowerCase()
  const role = Object.hasOwn(FOLDER_ROLE_WORDS, typed) ? FOLDER_ROLE_WORDS[typed] : undefined
  const exact = folders.filter(
    (f) => f.role === role || f.name.toLowerCase() === typed || f.id.toLowerCase() === typed,
  )
  const found = exact.length
    ? exact
    : folders.filter(
        (f) => f.name.toLowerCase().startsWith(typed) || f.id.toLowerCase().startsWith(typed),
      )
  return found.map((f) => f.id)
}

type TermSql = {
  [Kind in SearchTerm['kind']]: (
    term: Extract<SearchTerm, { kind: Kind }>,
    context: SearchContext,
  ) => SqlCondition
}

/**
 * The SQL for each kind of term. A new kind in SearchTerm fails the type
 * check until it has an entry here. Tags, for example, would become
 * `EXISTS (SELECT 1 FROM message_tags t WHERE t.account_id = m.account_id
 * AND t.folder = m.folder AND t.uid = m.uid AND t.tag = ?)`.
 */
const TERM_SQL: TermSql = {
  text: (term) => {
    const query = ftsQuery(term.field, term.text)
    if (!query) return NOTHING
    // Not correlated with m, so SQLite runs the full-text query once per search.
    return {
      sql: 'm.id IN (SELECT rowid FROM message_search WHERE message_search MATCH ?)',
      params: [query],
    }
  },
  status: (term) => {
    const sql = {
      unread: 'm.seen = 0',
      read: 'm.seen = 1',
      flagged: 'm.flagged = 1',
      replied: 'm.answered = 1',
    }[term.flag]
    return { sql, params: [] }
  },
  attachment: () => ({ sql: 'm.has_attachments = 1', params: [] }),
  date: (term) =>
    all([
      term.from === undefined ? null : { sql: 'm.date >= ?', params: [term.from] },
      term.until === undefined ? null : { sql: 'm.date < ?', params: [term.until] },
    ]),
  size: (term) =>
    all([
      term.larger === undefined ? null : { sql: 'm.size > ?', params: [term.larger] },
      term.smaller === undefined ? null : { sql: 'm.size < ?', params: [term.smaller] },
    ]),
  folder: (term, context) => {
    const ids = matchFolders(term.name, context.folders)
    if (ids.length === 0) return NOTHING
    return { sql: `m.folder IN (${ids.map(() => '?').join(', ')})`, params: ids }
  },
}

function all(conditions: (SqlCondition | null)[]): SqlCondition {
  return combine(
    'AND',
    conditions.filter((c): c is SqlCondition => c !== null),
  )
}

function combine(operator: 'AND' | 'OR', conditions: SqlCondition[]): SqlCondition {
  if (conditions.length === 0) return { sql: operator === 'AND' ? '1' : '0', params: [] }
  if (conditions.length === 1) return conditions[0]!
  return {
    sql: `(${conditions.map((c) => c.sql).join(` ${operator} `)})`,
    params: conditions.flatMap((c) => c.params),
  }
}

function termSql<Kind extends SearchTerm['kind']>(
  term: Extract<SearchTerm, { kind: Kind }>,
  context: SearchContext,
): SqlCondition {
  return (TERM_SQL[term.kind as Kind] as TermSql[Kind])(term, context)
}

export function searchCondition(node: SearchNode, context: SearchContext): SqlCondition {
  switch (node.type) {
    case 'term':
      return termSql(node.term, context)
    case 'not': {
      const inner = searchCondition(node.node, context)
      return { sql: `NOT (${inner.sql})`, params: inner.params }
    }
    case 'and':
      return combine(
        'AND',
        node.nodes.map((n) => searchCondition(n, context)),
      )
    case 'or':
      return combine(
        'OR',
        node.nodes.map((n) => searchCondition(n, context)),
      )
  }
}
