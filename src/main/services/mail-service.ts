import type { MailApi } from '@shared/ipc-contract'
import type {
  AccountId,
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
import type { FlagChange, MailProvider } from '../providers/types'
import type { AttachmentFiles } from './attachment-files'

/** Bodies of the newest messages are downloaded in the background, so they open at once. */
export const PREFETCH = { count: 25, maxSize: 2 * 1024 * 1024 } as const

/** When a sync for new mail fails, it is tried again after this long. */
export const WATCH_RETRY_MS = 30_000

interface RunningSync {
  promise: Promise<void>
  /** Someone asked again while it ran; changes may have arrived after it looked. */
  again: boolean
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
  syncFolder(accountId: AccountId, folderId: FolderId): Promise<void> {
    const key = JSON.stringify([accountId, folderId])
    const running = this.syncs.get(key)
    if (running) {
      running.again = true
      return running.promise
    }
    const entry: RunningSync = { promise: Promise.resolve(), again: false }
    entry.promise = (async () => {
      try {
        do {
          entry.again = false
          await this.runSync(accountId, folderId)
        } while (entry.again)
      } finally {
        this.syncs.delete(key)
      }
    })()
    this.syncs.set(key, entry)
    return entry.promise
  }

  private async runSync(accountId: AccountId, folderId: FolderId) {
    const provider = await this.provider(accountId)
    const changed = await provider.syncFolder(folderId, this.deps.cache)
    if (changed) this.deps.emit({ accountId, folderId })
    void this.prefetch(provider, folderId)
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
    const byFolder = new Map<FolderId, number[]>()
    for (const ref of messageIds.map(decodeMessageId)) {
      byFolder.set(ref.folderId, [...(byFolder.get(ref.folderId) ?? []), ref.uid])
    }
    for (const [folderId, uids] of byFolder) {
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

  /** Starts watching every account that isn't watched yet (new mail → sync → UI update). */
  async watchAll() {
    for (const provider of await this.deps.source.mailProviders()) {
      const accountId = provider.account.id
      if (this.watchers.has(accountId)) continue
      this.watchers.set(
        accountId,
        provider.watch((folderId) => this.syncForWatcher(accountId, folderId)),
      )
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
