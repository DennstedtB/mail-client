import type { MailApi } from '@shared/ipc-contract'
import type {
  AccountId,
  FlagChange,
  Folder,
  FolderId,
  MailChange,
  Message,
  MessageId,
  MessageSummary,
} from '@shared/types/mail'
import type { MailProviderSource } from '../accounts/account-service'
import type { CachedBody, CachedRow, MailCache } from '../cache/mail-cache'
import { decodeMessageId, encodeMessageId, type MessageRef } from '../mail/message-ref'
import type { MailProvider } from '../providers/types'
import type { AttachmentFiles } from './attachment-files'

/** Bodies of the newest messages are downloaded in the background, so they open at once. */
export const PREFETCH = { count: 25, maxSize: 2 * 1024 * 1024 } as const

/** When a sync for new mail fails, it is tried again after this long. */
export const WATCH_RETRY_MS = 30_000

interface RunningSync {
  promise: Promise<void>
  /** Someone asked again while it ran; changes may have arrived after it looked. */
  again: boolean
  /** Download the newest bodies afterwards (not for background syncs of all folders). */
  prefetch: boolean
}

export interface MailServiceDeps {
  source: MailProviderSource
  cache: MailCache
  /** Tells the UI that cached mail changed. */
  emit(change: MailChange): void
  files: AttachmentFiles
}

export function toSummary(accountId: AccountId, row: CachedRow): MessageSummary {
  return {
    id: encodeMessageId({ folderId: row.folder, uid: row.uid }),
    accountId,
    folderId: row.folder,
    from: row.from,
    subject: row.subject,
    preview: row.preview,
    date: row.date,
    isRead: row.seen,
    isFlagged: row.flagged,
    isAnswered: row.answered,
    hasAttachments: row.hasAttachments,
  }
}

/**
 * Implements the mail part of the IPC contract: lists come from the local
 * cache, providers keep the cache in step with the servers.
 */
export class MailService implements MailApi {
  private readonly syncs = new Map<string, RunningSync>()
  private readonly watchers = new Map<AccountId, () => void>()
  private readonly retries = new Map<string, NodeJS.Timeout>()

  constructor(private readonly deps: MailServiceDeps) {}

  async listFolders(accountId: AccountId): Promise<Folder[]> {
    return (await this.provider(accountId)).listFolders()
  }

  async listMessages(accountId: AccountId, folderId: FolderId): Promise<MessageSummary[]> {
    await this.provider(accountId)
    return this.deps.cache.listMessages(accountId, folderId).map((row) => toSummary(accountId, row))
  }

  /**
   * One sync per folder at a time. A request that arrives while one runs
   * joins it, and the folder is synced once more afterwards, so nothing that
   * arrived in between is missed.
   */
  syncFolder(
    accountId: AccountId,
    folderId: FolderId,
    options: { prefetch?: boolean } = {},
  ): Promise<void> {
    const prefetch = options.prefetch ?? true
    const key = JSON.stringify([accountId, folderId])
    const running = this.syncs.get(key)
    if (running) {
      running.again = true
      running.prefetch ||= prefetch
      return running.promise
    }
    const entry: RunningSync = { promise: Promise.resolve(), again: false, prefetch }
    entry.promise = (async () => {
      try {
        do {
          entry.again = false
          await this.runSync(accountId, folderId, entry.prefetch)
        } while (entry.again)
      } finally {
        this.syncs.delete(key)
      }
    })()
    this.syncs.set(key, entry)
    return entry.promise
  }

  private async runSync(accountId: AccountId, folderId: FolderId, prefetch: boolean) {
    const provider = await this.provider(accountId)
    const changed = await provider.syncFolder(folderId, this.deps.cache)
    if (changed) this.deps.emit({ accountId, folderId })
    if (prefetch) void this.prefetch(provider, folderId)
  }

  private async prefetch(provider: MailProvider, folderId: FolderId) {
    const accountId = provider.account.id
    const uids = this.deps.cache.uidsWithoutBody(
      accountId,
      folderId,
      PREFETCH.count,
      PREFETCH.maxSize,
    )
    let fetched = 0
    for (const uid of uids) {
      try {
        await this.loadBody(provider, { folderId, uid })
        fetched++
      } catch {
        // Skipped here; opening the message tries again and shows the error.
      }
    }
    if (fetched > 0) this.deps.emit({ accountId, folderId })
  }

  private async loadBody(provider: MailProvider, ref: MessageRef) {
    const parsed = await provider.fetchMessage(ref)
    this.deps.cache.setBody(provider.account.id, ref.folderId, ref.uid, {
      text: parsed.text,
      html: parsed.html,
      attachments: parsed.attachments,
      headers: {
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        replyTo: parsed.replyTo,
      },
      preview: parsed.preview,
      to: parsed.to,
      cc: parsed.cc,
    })
  }

  /** A cached message with its body; downloads the body if it isn't cached yet. */
  async loadMessage(
    accountId: AccountId,
    messageId: MessageId,
  ): Promise<{ row: CachedRow; body: CachedBody } | null> {
    const provider = await this.provider(accountId)
    const ref = decodeMessageId(messageId)
    const row = this.deps.cache.getMessage(accountId, ref.folderId, ref.uid)
    if (!row) return null
    let body = this.deps.cache.getBody(accountId, ref.folderId, ref.uid)
    if (!body) {
      await this.loadBody(provider, ref)
      body = this.deps.cache.getBody(accountId, ref.folderId, ref.uid)
      if (!body) return null
    }
    return { row, body }
  }

  async getMessage(accountId: AccountId, messageId: MessageId): Promise<Message | null> {
    const loaded = await this.loadMessage(accountId, messageId)
    if (!loaded) return null
    const { row, body } = loaded
    return {
      ...toSummary(accountId, { ...row, preview: body.preview }),
      to: body.to.length > 0 ? body.to : row.to,
      cc: body.cc.length > 0 ? body.cc : row.cc,
      bodyText: body.text,
      bodyHtml: body.html,
      attachments: body.attachments,
    }
  }

  async openAttachment(accountId: AccountId, messageId: MessageId, attachmentId: string) {
    const provider = await this.provider(accountId)
    await this.deps.files.open(
      await provider.fetchAttachment(decodeMessageId(messageId), attachmentId),
    )
  }

  async saveAttachment(accountId: AccountId, messageId: MessageId, attachmentId: string) {
    const provider = await this.provider(accountId)
    return this.deps.files.save(
      await provider.fetchAttachment(decodeMessageId(messageId), attachmentId),
    )
  }

  /**
   * Changes flags. The cache (and so the UI) changes first; if the server
   * refuses, the cache gets its previous flags back, and a sync then makes
   * sure it matches the server.
   */
  async setFlags(accountId: AccountId, messageIds: MessageId[], change: FlagChange) {
    const provider = await this.provider(accountId)
    for (const [folderId, uids] of byFolder(messageIds)) {
      const rows = uids.flatMap((uid) => {
        const row = this.deps.cache.getMessage(accountId, folderId, uid)
        return row ? [row] : []
      })
      const previous = rows.map(({ uid, seen, flagged, answered }) => ({
        uid,
        seen,
        flagged,
        answered,
      }))
      const updated = rows.map((row) => ({
        uid: row.uid,
        seen: change.seen ?? row.seen,
        flagged: change.flagged ?? row.flagged,
        answered: change.answered ?? row.answered,
      }))
      if (this.deps.cache.updateFlags(accountId, folderId, updated) > 0) {
        this.deps.emit({ accountId, folderId })
      }
      try {
        await provider.setFlags(folderId, uids, change)
      } catch (error) {
        if (this.deps.cache.updateFlags(accountId, folderId, previous) > 0) {
          this.deps.emit({ accountId, folderId })
        }
        await this.syncFolder(accountId, folderId).catch(() => undefined)
        throw error
      }
      // Again, so unread counts (which come from the server) catch up.
      this.deps.emit({ accountId, folderId })
    }
  }

  /**
   * Moves messages. They leave the list at once; if the server refuses,
   * they are put back and the error is passed on.
   */
  async moveMessages(accountId: AccountId, messageIds: MessageId[], targetFolderId: FolderId) {
    const provider = await this.provider(accountId)
    await this.removeFromFolders(accountId, messageIds, targetFolderId, (folderId, uids) =>
      provider.moveMessages(folderId, uids, targetFolderId),
    )
    void this.syncFolder(accountId, targetFolderId).catch(() => undefined)
  }

  async deleteMessages(accountId: AccountId, messageIds: MessageId[]) {
    const provider = await this.provider(accountId)
    await this.removeFromFolders(accountId, messageIds, null, (folderId, uids) =>
      provider.deleteMessages(folderId, uids),
    )
  }

  private async removeFromFolders(
    accountId: AccountId,
    messageIds: MessageId[],
    skipFolder: FolderId | null,
    onServer: (folderId: FolderId, uids: number[]) => Promise<void>,
  ) {
    for (const [folderId, uids] of byFolder(messageIds)) {
      if (folderId === skipFolder) continue
      const removed = this.deps.cache.snapshot(accountId, folderId, uids)
      this.deps.cache.removeMessages(accountId, folderId, uids)
      this.deps.emit({ accountId, folderId })
      try {
        await onServer(folderId, uids)
      } catch (error) {
        this.deps.cache.restore(accountId, folderId, removed)
        this.deps.emit({ accountId, folderId })
        throw error
      }
      // Again, so the folder counts (from the server) catch up.
      this.deps.emit({ accountId, folderId })
    }
  }

  async createFolder(accountId: AccountId, name: string): Promise<FolderId> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('A folder needs a name.')
    const folderId = await (await this.provider(accountId)).createFolder(trimmed)
    this.deps.emit({ accountId })
    return folderId
  }

  async search(accountId: AccountId, query: string): Promise<MessageSummary[]> {
    await this.provider(accountId)
    return this.deps.cache.search(accountId, query).map((row) => toSummary(accountId, row))
  }

  /** Starts watching every account that isn't watched yet (new mail → sync → UI update). */
  async watchAll() {
    for (const provider of await this.deps.source.mailProviders()) {
      const accountId = provider.account.id
      if (this.watchers.has(accountId)) continue
      this.watchers.set(
        accountId,
        provider.watch((folderId) => this.syncForWatcher(accountId, folderId)),
      )
      void this.syncAllFolders(provider)
    }
  }

  /**
   * Syncs every folder once in the background, so search covers all of them,
   * not only the folders opened so far. Bodies are downloaded only for
   * folders that are opened (and the inbox, which the watcher keeps current).
   */
  private async syncAllFolders(provider: MailProvider) {
    const accountId = provider.account.id
    let folders: Folder[]
    try {
      folders = await provider.listFolders()
    } catch {
      return
    }
    for (const folder of folders) {
      // Stop if the account was removed meanwhile.
      if (!this.watchers.has(accountId)) return
      if (folder.role === 'inbox') continue
      await this.syncFolder(accountId, folder.id, { prefetch: false }).catch(() => undefined)
    }
  }

  /** A sync that new mail asked for; if it fails, it's tried again a little later. */
  private syncForWatcher(accountId: AccountId, folderId: FolderId) {
    const key = JSON.stringify([accountId, folderId])
    clearTimeout(this.retries.get(key))
    this.retries.delete(key)
    this.syncFolder(accountId, folderId).catch(() => {
      if (!this.watchers.has(accountId)) return
      this.retries.set(
        key,
        setTimeout(() => {
          this.retries.delete(key)
          this.syncForWatcher(accountId, folderId)
        }, WATCH_RETRY_MS),
      )
    })
  }

  /** Stops watching a removed account and drops its cache. */
  forget(accountId: AccountId) {
    this.watchers.get(accountId)?.()
    this.watchers.delete(accountId)
    for (const [key, timer] of this.retries) {
      if ((JSON.parse(key) as [string, string])[0] === accountId) {
        clearTimeout(timer)
        this.retries.delete(key)
      }
    }
    this.deps.cache.deleteAccount(accountId)
  }

  private provider(accountId: AccountId): Promise<MailProvider> {
    return this.deps.source.provider(accountId)
  }
}

/** Groups message ids by folder, keeping the order of first appearance. */
function byFolder(messageIds: MessageId[]): Map<FolderId, number[]> {
  const groups = new Map<FolderId, number[]>()
  for (const ref of messageIds.map(decodeMessageId)) {
    groups.set(ref.folderId, [...(groups.get(ref.folderId) ?? []), ref.uid])
  }
  return groups
}
