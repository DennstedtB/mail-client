import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { SearchNode } from '@shared/search-query'
import {
  MESSAGE_LIST_LIMIT,
  SEARCH_RESULT_LIMIT,
  type AccountId,
  type Address,
  type Attachment,
  type FolderId,
  type FolderRole,
} from '@shared/types/mail'
import { searchCondition, type SearchFolder } from './search-sql'

/**
 * The local copy of message lists and bodies (node:sqlite, built into
 * Electron's Node; no native module). It is only a cache: the schema version
 * is checked on open, and a mismatch simply rebuilds it from the server.
 */
/**
 * 2: bodies keep Reply-To (M3). 3: search operators: folders, attachment
 * names, To and Cc indexed apart, and the search index keyed by message id.
 * A different version rebuilds the cache from the servers.
 */
const SCHEMA_VERSION = 3

const SCHEMA = `
CREATE TABLE folder_state (
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid_validity TEXT NOT NULL,
  highest_uid INTEGER NOT NULL,
  PRIMARY KEY (account_id, folder)
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  message_id TEXT,
  subject TEXT NOT NULL,
  from_name TEXT,
  from_email TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL,
  date TEXT NOT NULL,
  seen INTEGER NOT NULL,
  flagged INTEGER NOT NULL,
  answered INTEGER NOT NULL,
  has_attachments INTEGER NOT NULL,
  size INTEGER NOT NULL,
  attachment_names_json TEXT NOT NULL DEFAULT '[]',
  preview TEXT NOT NULL DEFAULT '',
  UNIQUE (account_id, folder, uid)
);
CREATE INDEX messages_by_date ON messages (account_id, folder, date DESC);
CREATE TABLE bodies (
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  text TEXT NOT NULL,
  html TEXT,
  attachments_json TEXT NOT NULL,
  headers_json TEXT NOT NULL,
  PRIMARY KEY (account_id, folder, uid)
);
CREATE TABLE folders (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);
-- One row per message; its rowid is messages.id, so updates and searches find it by index.
CREATE VIRTUAL TABLE message_search USING fts5(
  subject, sender, to_list, cc_list, body, filenames,
  tokenize = 'unicode61 remove_diacritics 2'
);
`

export interface CachedEnvelope {
  uid: number
  messageId?: string
  subject: string
  from: Address
  to: Address[]
  cc: Address[]
  /** ISO 8601 */
  date: string
  seen: boolean
  flagged: boolean
  answered: boolean
  hasAttachments: boolean
  /** File names of the attachments, as far as the message structure tells; for search. */
  attachmentNames: string[]
  size: number
}

export interface CachedFlags {
  uid: number
  seen: boolean
  flagged: boolean
  answered: boolean
}

export interface CachedRow extends CachedEnvelope {
  folder: FolderId
  preview: string
}

/** Headers needed for replies. */
export interface BodyHeaders {
  messageId?: string
  inReplyTo?: string
  references: string[]
  /** Reply-To; absent in bodies cached before M3, which is treated as none. */
  replyTo?: Address[]
}

export interface CachedBody {
  text: string
  html?: string
  attachments: Attachment[]
  headers: BodyHeaders
  preview: string
  to: Address[]
  cc: Address[]
}

/** What the cache holds of one message, to put it back if a move or delete fails. */
export interface CachedMessage {
  row: CachedRow
  body: CachedBody | null
}

export interface FolderState {
  uidValidity: string
  highestUid: number
}

type Row = Record<string, SQLInputValue>

function addressText(addresses: Address[]): string {
  return addresses.map((a) => [a.name, a.email].filter(Boolean).join(' ')).join(' ')
}

export class MailCache {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    if (version !== SCHEMA_VERSION) this.rebuild()
  }

  close() {
    this.db.close()
  }

  /** Drops everything (FTS shadow tables go with their virtual table) and starts empty. */
  private rebuild() {
    this.transaction(() => {
      this.db.exec('DROP TABLE IF EXISTS message_search')
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
      for (const { name } of tables)
        this.db.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`)
      this.db.exec(SCHEMA)
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    })
  }

  /** Runs work in one transaction; nested calls join the outer one. */
  private transaction<T>(work: () => T): T {
    if (this.db.isTransaction) return work()
    this.db.exec('BEGIN')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  folderState(accountId: AccountId, folder: FolderId): FolderState | null {
    const row = this.db
      .prepare(
        'SELECT uid_validity, highest_uid FROM folder_state WHERE account_id = ? AND folder = ?',
      )
      .get(accountId, folder) as { uid_validity: string; highest_uid: number } | undefined
    return row ? { uidValidity: row.uid_validity, highestUid: row.highest_uid } : null
  }

  setFolderState(accountId: AccountId, folder: FolderId, state: FolderState) {
    this.db
      .prepare(
        `INSERT INTO folder_state (account_id, folder, uid_validity, highest_uid) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id, folder) DO UPDATE SET uid_validity = excluded.uid_validity, highest_uid = excluded.highest_uid`,
      )
      .run(accountId, folder, state.uidValidity, state.highestUid)
  }

  /** Forgets everything about a folder, e.g. when its UIDVALIDITY changed. */
  resetFolder(accountId: AccountId, folder: FolderId) {
    this.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM message_search WHERE rowid IN
            (SELECT id FROM messages WHERE account_id = ? AND folder = ?)`,
        )
        .run(accountId, folder)
      for (const table of ['messages', 'bodies', 'folder_state']) {
        this.db
          .prepare(`DELETE FROM ${table} WHERE account_id = ? AND folder = ?`)
          .run(accountId, folder)
      }
    })
  }

  deleteAccount(accountId: AccountId) {
    this.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM message_search WHERE rowid IN (SELECT id FROM messages WHERE account_id = ?)',
        )
        .run(accountId)
      for (const table of ['messages', 'bodies', 'folder_state', 'folders']) {
        this.db.prepare(`DELETE FROM ${table} WHERE account_id = ?`).run(accountId)
      }
    })
  }

  upsertMessages(accountId: AccountId, folder: FolderId, messages: CachedEnvelope[]) {
    if (messages.length === 0) return
    const upsert = this.db.prepare(
      `INSERT INTO messages (account_id, folder, uid, message_id, subject, from_name, from_email, to_json, cc_json,
         date, seen, flagged, answered, has_attachments, size, attachment_names_json)
       VALUES (:account_id, :folder, :uid, :message_id, :subject, :from_name, :from_email, :to_json, :cc_json,
         :date, :seen, :flagged, :answered, :has_attachments, :size, :attachment_names_json)
       ON CONFLICT (account_id, folder, uid) DO UPDATE SET
         seen = excluded.seen, flagged = excluded.flagged, answered = excluded.answered
       RETURNING id`,
    )
    const removeIndex = this.db.prepare('DELETE FROM message_search WHERE rowid = ?')
    // The body text comes from a downloaded body, if there is one, so it stays searchable.
    const index = this.db.prepare(
      `INSERT INTO message_search (rowid, subject, sender, to_list, cc_list, filenames, body)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, coalesce(
         (SELECT text FROM bodies WHERE account_id = ?7 AND folder = ?8 AND uid = ?9), ''))`,
    )
    this.transaction(() => {
      for (const m of messages) {
        const row: Row = {
          account_id: accountId,
          folder,
          uid: m.uid,
          message_id: m.messageId ?? null,
          subject: m.subject,
          from_name: m.from.name ?? null,
          from_email: m.from.email,
          to_json: JSON.stringify(m.to),
          cc_json: JSON.stringify(m.cc),
          date: m.date,
          seen: m.seen ? 1 : 0,
          flagged: m.flagged ? 1 : 0,
          answered: m.answered ? 1 : 0,
          has_attachments: m.hasAttachments ? 1 : 0,
          size: m.size,
          attachment_names_json: JSON.stringify(m.attachmentNames),
        }
        const { id } = upsert.get(row) as { id: number }
        removeIndex.run(id)
        index.run(
          id,
          m.subject,
          addressText([m.from]),
          addressText(m.to),
          addressText(m.cc),
          m.attachmentNames.join('\n'),
          accountId,
          folder,
          m.uid,
        )
      }
    })
  }

  updateFlags(accountId: AccountId, folder: FolderId, flags: CachedFlags[]): number {
    const update = this.db.prepare(
      `UPDATE messages SET seen = ?, flagged = ?, answered = ?
       WHERE account_id = ? AND folder = ? AND uid = ? AND (seen != ? OR flagged != ? OR answered != ?)`,
    )
    let changed = 0
    this.transaction(() => {
      for (const f of flags) {
        const [s, fl, a] = [f.seen ? 1 : 0, f.flagged ? 1 : 0, f.answered ? 1 : 0]
        changed += Number(update.run(s, fl, a, accountId, folder, f.uid, s, fl, a).changes)
      }
    })
    return changed
  }

  removeMessages(accountId: AccountId, folder: FolderId, uids: number[]) {
    if (uids.length === 0) return
    this.transaction(() => {
      const removeIndex = this.db.prepare(
        `DELETE FROM message_search WHERE rowid =
          (SELECT id FROM messages WHERE account_id = ? AND folder = ? AND uid = ?)`,
      )
      for (const uid of uids) removeIndex.run(accountId, folder, uid)
      for (const table of ['messages', 'bodies']) {
        const statement = this.db.prepare(
          `DELETE FROM ${table} WHERE account_id = ? AND folder = ? AND uid = ?`,
        )
        for (const uid of uids) statement.run(accountId, folder, uid)
      }
    })
  }

  /** Copies of these messages (envelope and body), for restore(). */
  snapshot(accountId: AccountId, folder: FolderId, uids: number[]): CachedMessage[] {
    return uids.flatMap((uid) => {
      const row = this.getMessage(accountId, folder, uid)
      return row ? [{ row, body: this.getBody(accountId, folder, uid) }] : []
    })
  }

  /** Puts messages from snapshot() back, e.g. after the server refused to move them. */
  restore(accountId: AccountId, folder: FolderId, messages: CachedMessage[]) {
    this.transaction(() => {
      this.upsertMessages(
        accountId,
        folder,
        messages.map((m) => m.row),
      )
      for (const m of messages) {
        if (m.body) this.setBody(accountId, folder, m.row.uid, m.body)
      }
    })
  }

  cachedUids(accountId: AccountId, folder: FolderId): number[] {
    const rows = this.db
      .prepare('SELECT uid FROM messages WHERE account_id = ? AND folder = ? ORDER BY uid')
      .all(accountId, folder) as { uid: number }[]
    return rows.map((r) => r.uid)
  }

  listMessages(accountId: AccountId, folder: FolderId, limit = MESSAGE_LIST_LIMIT): CachedRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE account_id = ? AND folder = ?
         ORDER BY date DESC, uid DESC LIMIT ?`,
      )
      .all(accountId, folder, limit) as Row[]
    return rows.map(toCachedRow)
  }

  getMessage(accountId: AccountId, folder: FolderId, uid: number): CachedRow | null {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE account_id = ? AND folder = ? AND uid = ?')
      .get(accountId, folder, uid) as Row | undefined
    return row ? toCachedRow(row) : null
  }

  getBody(accountId: AccountId, folder: FolderId, uid: number): CachedBody | null {
    const row = this.db
      .prepare(
        `SELECT b.*, m.preview, m.to_json, m.cc_json FROM bodies b
         JOIN messages m USING (account_id, folder, uid)
         WHERE b.account_id = ? AND b.folder = ? AND b.uid = ?`,
      )
      .get(accountId, folder, uid) as Row | undefined
    if (!row) return null
    return {
      text: String(row['text']),
      html: row['html'] === null ? undefined : String(row['html']),
      attachments: JSON.parse(String(row['attachments_json'])) as Attachment[],
      headers: JSON.parse(String(row['headers_json'])) as BodyHeaders,
      preview: String(row['preview']),
      to: JSON.parse(String(row['to_json'])) as Address[],
      cc: JSON.parse(String(row['cc_json'])) as Address[],
    }
  }

  /** Stores a downloaded body; also fills in the preview and the search index. */
  setBody(accountId: AccountId, folder: FolderId, uid: number, body: CachedBody) {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO bodies (account_id, folder, uid, text, html, attachments_json, headers_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          accountId,
          folder,
          uid,
          body.text,
          body.html ?? null,
          JSON.stringify(body.attachments),
          JSON.stringify(body.headers),
        )
      this.db
        .prepare('UPDATE messages SET preview = ? WHERE account_id = ? AND folder = ? AND uid = ?')
        .run(body.preview, accountId, folder, uid)
      this.db
        .prepare(
          `UPDATE message_search SET body = ? WHERE rowid =
            (SELECT id FROM messages WHERE account_id = ? AND folder = ? AND uid = ?)`,
        )
        .run(body.text, accountId, folder, uid)
    })
  }

  /** Newest messages whose body hasn't been downloaded yet, for background prefetch. */
  uidsWithoutBody(
    accountId: AccountId,
    folder: FolderId,
    limit: number,
    maxSize: number,
  ): number[] {
    const rows = this.db
      .prepare(
        `SELECT m.uid FROM messages m
         LEFT JOIN bodies b USING (account_id, folder, uid)
         WHERE m.account_id = ? AND m.folder = ? AND b.uid IS NULL AND m.size <= ?
         ORDER BY m.date DESC LIMIT ?`,
      )
      .all(accountId, folder, maxSize, limit) as { uid: number }[]
    return rows.map((r) => r.uid)
  }

  /** Keeps the folder list of an account, so search can find folders by role or name offline. */
  setFolders(accountId: AccountId, folders: SearchFolder[]) {
    const insert = this.db.prepare(
      'INSERT INTO folders (account_id, id, name, role) VALUES (?, ?, ?, ?)',
    )
    this.transaction(() => {
      this.db.prepare('DELETE FROM folders WHERE account_id = ?').run(accountId)
      for (const f of folders) insert.run(accountId, f.id, f.name, f.role)
    })
  }

  folders(accountId: AccountId): SearchFolder[] {
    const rows = this.db
      .prepare('SELECT id, name, role FROM folders WHERE account_id = ? ORDER BY id')
      .all(accountId) as { id: string; name: string; role: FolderRole }[]
    return rows.map(({ id, name, role }) => ({ id, name, role }))
  }

  /**
   * Messages of one account, in all folders, that match a parsed search
   * (src/shared/search-query.ts), newest first.
   */
  search(accountId: AccountId, search: SearchNode, limit = SEARCH_RESULT_LIMIT): CachedRow[] {
    const condition = searchCondition(search, { folders: this.folders(accountId) })
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages m WHERE m.account_id = ? AND ${condition.sql}
         ORDER BY m.date DESC, m.uid DESC LIMIT ?`,
      )
      .all(accountId, ...condition.params, limit) as Row[]
    return rows.map(toCachedRow)
  }
}

function toCachedRow(row: Row): CachedRow {
  return {
    folder: String(row['folder']),
    uid: Number(row['uid']),
    messageId: row['message_id'] === null ? undefined : String(row['message_id']),
    subject: String(row['subject']),
    from: {
      ...(row['from_name'] ? { name: String(row['from_name']) } : {}),
      email: String(row['from_email']),
    },
    to: JSON.parse(String(row['to_json'])) as Address[],
    cc: JSON.parse(String(row['cc_json'])) as Address[],
    date: String(row['date']),
    seen: row['seen'] === 1,
    flagged: row['flagged'] === 1,
    answered: row['answered'] === 1,
    hasAttachments: row['has_attachments'] === 1,
    attachmentNames: JSON.parse(String(row['attachment_names_json'])) as string[],
    size: Number(row['size']),
    preview: String(row['preview']),
  }
}
