import type { Account, Folder, FolderId } from '@shared/types/mail'
import type { CachedEnvelope, MailCache } from '../../cache/mail-cache'
import { makePreview, type MessageRef } from '../../mail/message-ref'
import type { AttachmentContent, ParsedMessage } from '../../mail/parse-message'
import type { FlagChange, MailProvider } from '../types'
import { MOCK_FOLDERS, MOCK_MESSAGES, ME, type MockMessage } from './mock-data'

export const MOCK_ACCOUNT_ID = 'mock'

export { makePreview }

interface StoredMock extends MockMessage {
  uid: number
  date: string
  answered: boolean
}

/**
 * The sample mailbox shown while no account exists. It goes through the same
 * cache as real accounts, so the UI and the sync path are exercised either way.
 */
export class MockMailProvider implements MailProvider {
  readonly account: Account = {
    id: MOCK_ACCOUNT_ID,
    name: 'Sample mailbox',
    senderName: ME.name ?? '',
    email: ME.email,
    kind: 'mock',
  }

  private readonly messages: StoredMock[]
  private readonly folders = [...MOCK_FOLDERS]

  constructor(now: Date = new Date()) {
    this.messages = MOCK_MESSAGES.map((m, index) => ({
      ...m,
      uid: index + 1,
      date: new Date(now.getTime() - m.minutesAgo * 60_000).toISOString(),
      answered: false,
    }))
  }

  async listFolders(): Promise<Folder[]> {
    return this.folders.map((folder) => {
      const inFolder = this.messages.filter((m) => m.folderId === folder.id)
      return {
        ...folder,
        accountId: this.account.id,
        unreadCount: inFolder.filter((m) => !m.isRead).length,
        totalCount: inFolder.length,
      }
    })
  }

  async syncFolder(folderId: FolderId, cache: MailCache): Promise<boolean> {
    const inFolder = this.messages.filter((m) => m.folderId === folderId)
    const uids = new Set(inFolder.map((m) => m.uid))
    const before = cache.cachedUids(this.account.id, folderId)
    const known = new Set(before)
    const stale = before.filter((uid) => !uids.has(uid))
    cache.removeMessages(this.account.id, folderId, stale)
    const flagChanges = cache.updateFlags(
      this.account.id,
      folderId,
      inFolder.filter((m) => known.has(m.uid)).map(toEnvelope),
    )
    let changed = stale.length > 0 || flagChanges > 0 || inFolder.some((m) => !known.has(m.uid))
    cache.upsertMessages(this.account.id, folderId, inFolder.map(toEnvelope))
    for (const m of inFolder) {
      if (!cache.getBody(this.account.id, folderId, m.uid)) {
        changed = true
        const parsed = this.parsed(m)
        cache.setBody(this.account.id, folderId, m.uid, {
          ...parsed,
          headers: { references: [] },
        })
      }
    }
    cache.setFolderState(this.account.id, folderId, {
      uidValidity: '1',
      highestUid: Math.max(0, ...uids),
    })
    return changed
  }

  async fetchMessage(ref: MessageRef): Promise<ParsedMessage> {
    return this.parsed(this.find(ref))
  }

  async fetchAttachment(ref: MessageRef, attachmentId: string): Promise<AttachmentContent> {
    const attachment = this.find(ref).attachments?.find((a) => a.id === attachmentId)
    if (!attachment) throw new Error('This attachment no longer exists.')
    return {
      filename: attachment.filename,
      mimeType: 'text/plain',
      content: Buffer.from(`Sample attachment "${attachment.filename}" from the sample mailbox.\n`),
    }
  }

  async send(): Promise<never> {
    throw new Error("The sample mailbox can't send mail. Add an account to send messages.")
  }

  async setFlags(folderId: FolderId, uids: number[], change: FlagChange) {
    for (const m of this.messages) {
      if (m.folderId !== folderId || !uids.includes(m.uid)) continue
      if (change.seen !== undefined) m.isRead = change.seen
      if (change.flagged !== undefined) m.isFlagged = change.flagged
      if (change.answered !== undefined) m.answered = change.answered
    }
  }

  async moveMessages(folderId: FolderId, uids: number[], targetFolderId: FolderId) {
    // New UIDs in the target folder, as an IMAP server would assign them.
    let next = Math.max(0, ...this.messages.map((m) => m.uid)) + 1
    for (const m of this.messages) {
      if (m.folderId === folderId && uids.includes(m.uid)) {
        m.folderId = targetFolderId
        m.uid = next++
      }
    }
  }

  async createFolder(name: string): Promise<FolderId> {
    if (!this.folders.some((f) => f.id === name)) {
      this.folders.push({ id: name, name, role: 'custom' })
    }
    return name
  }

  async deleteMessages(folderId: FolderId, uids: number[]) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]
      if (m && m.folderId === folderId && uids.includes(m.uid)) this.messages.splice(i, 1)
    }
  }

  /** The sample mailbox never changes on its own. */
  watch(_onChange: (folderId: FolderId) => void): () => void {
    return () => {}
  }

  async close() {}

  private find(ref: MessageRef): StoredMock {
    const message = this.messages.find((m) => m.uid === ref.uid && m.folderId === ref.folderId)
    if (!message) throw new Error('This message no longer exists.')
    return message
  }

  private parsed(m: StoredMock): ParsedMessage {
    return {
      text: m.bodyText,
      attachments: m.attachments ?? [],
      preview: makePreview(m.bodyText),
      references: [],
      replyTo: [],
      to: m.to,
      cc: m.cc ?? [],
    }
  }
}

function toEnvelope(m: StoredMock): CachedEnvelope {
  return {
    uid: m.uid,
    subject: m.subject,
    from: m.from,
    to: m.to,
    cc: m.cc ?? [],
    date: m.date,
    seen: m.isRead,
    flagged: m.isFlagged ?? false,
    answered: m.answered,
    hasAttachments: (m.attachments?.length ?? 0) > 0,
    size: m.bodyText.length,
  }
}
