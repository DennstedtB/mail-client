import { randomUUID } from 'node:crypto'
import type { DraftAttachment } from '@shared/types/compose'
import type { AccountId, MessageId } from '@shared/types/mail'

/** Where a draft attachment's content comes from. Only the main process knows. */
export type AttachmentSource =
  | { kind: 'file'; path: string }
  | { kind: 'forwarded'; accountId: AccountId; messageId: MessageId; attachmentId: string }

interface Entry {
  attachment: DraftAttachment
  source: AttachmentSource
}

/**
 * Hands out tokens for draft attachments. The UI only ever holds the token,
 * so it can't make the app send a file the user didn't pick.
 */
export class DraftAttachments {
  private readonly entries = new Map<string, Entry>()

  add(filename: string, size: number, source: AttachmentSource): DraftAttachment {
    const attachment = { id: randomUUID(), filename, size }
    this.entries.set(attachment.id, { attachment, source })
    return attachment
  }

  /** The entries for these tokens, or null if one of them is unknown. */
  resolve(ids: string[]): Entry[] | null {
    const found = ids.map((id) => this.entries.get(id))
    return found.every((e): e is Entry => e !== undefined) ? found : null
  }

  release(ids: string[]) {
    for (const id of ids) this.entries.delete(id)
  }

  get size() {
    return this.entries.size
  }
}
