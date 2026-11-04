/**
 * The one contract between UI and backend.
 *
 * The renderer only ever sees `Api` (as `window.api`). The main process
 * implements it and registers every method listed in `API_METHODS` as an IPC
 * handler. Keeping this the single seam is what makes a later backend swap
 * (e.g. Tauri) possible without touching the UI.
 *
 * To add a method: add it to the interface, then to `API_METHODS`. The type
 * check at the bottom fails until both are in sync.
 */

import type { AddAccountResult, NewAccountInput } from './types/account'
import type { ComposeKind, Draft, DraftAttachment, SendResult } from './types/compose'
import type {
  Account,
  AccountId,
  FlagChange,
  Folder,
  FolderId,
  MailChange,
  Message,
  MessageId,
  MessageSummary,
} from './types/mail'

export interface AppInfo {
  name: string
  version: string
  platform: string
  /** Current roadmap milestone, shown in the UI while the app is in development. */
  milestone: string
  /** True when running from source (`npm run dev`), false in the packaged app. */
  isDevelopment: boolean
}

export interface AppApi {
  getInfo(): Promise<AppInfo>
}

export interface AccountsApi {
  /** The user's accounts, or the sample mailbox while none has been added. */
  list(): Promise<Account[]>
  /** Checks IMAP and SMTP, and saves the account only if both work. */
  add(input: NewAccountInput): Promise<AddAccountResult>
  /** Removes the account and its stored password. Mail on the server is untouched. */
  remove(accountId: AccountId): Promise<void>
}

export interface MailApi {
  /** Folders with unread and total counts, straight from the server. */
  listFolders(accountId: AccountId): Promise<Folder[]>
  /** Messages from the local cache, newest first. Returns at once; see syncFolder. */
  listMessages(accountId: AccountId, folderId: FolderId): Promise<MessageSummary[]>
  /** Brings the cache for a folder up to date with the server, then emits a MailChange. */
  syncFolder(accountId: AccountId, folderId: FolderId): Promise<void>
  /** The full message; downloaded and cached on first use. */
  getMessage(accountId: AccountId, messageId: MessageId): Promise<Message | null>
  /** Opens an attachment with the default app. Refuses file types that can run code. */
  openAttachment(accountId: AccountId, messageId: MessageId, attachmentId: string): Promise<void>
  /** Asks where to save an attachment. False if the user cancelled. */
  saveAttachment(accountId: AccountId, messageId: MessageId, attachmentId: string): Promise<boolean>
  /** Read / unread, flagged. The list updates at once; the server follows. */
  setFlags(accountId: AccountId, messageIds: MessageId[], change: FlagChange): Promise<void>
  /** Moves messages to another folder of the same account (also archive and trash). */
  moveMessages(
    accountId: AccountId,
    messageIds: MessageId[],
    targetFolderId: FolderId,
  ): Promise<void>
  /** Deletes messages for good. The UI asks first. */
  deleteMessages(accountId: AccountId, messageIds: MessageId[]): Promise<void>
  /** Creates a top-level folder, e.g. "Archive" on servers that have none. Returns its id. */
  createFolder(accountId: AccountId, name: string): Promise<FolderId>
  /** Searches subject, people and downloaded message text in all folders of an account. */
  search(accountId: AccountId, query: string): Promise<MessageSummary[]>
}

export interface ComposeApi {
  /**
   * A draft to start from: empty for a new message; for replies and forwards
   * with recipients, subject, quoted text and (forward) the original attachments.
   */
  prepare(kind: ComposeKind, accountId: AccountId, sourceMessageId?: MessageId): Promise<Draft>
  /** Opens the system file dialog. Returns the picked files, or [] if cancelled. */
  addAttachments(): Promise<DraftAttachment[]>
  /** Sends the draft and saves a copy in the Sent folder. */
  send(draft: Draft): Promise<SendResult>
  /** Forgets attachment tokens of a discarded draft. */
  discard(draft: Draft): Promise<void>
}

export interface Api {
  app: AppApi
  accounts: AccountsApi
  mail: MailApi
  compose: ComposeApi
}

export type Namespace = keyof Api

export const API_METHODS = {
  app: ['getInfo'],
  accounts: ['list', 'add', 'remove'],
  mail: [
    'listFolders',
    'listMessages',
    'syncFolder',
    'getMessage',
    'openAttachment',
    'saveAttachment',
    'setFlags',
    'moveMessages',
    'deleteMessages',
    'createFolder',
    'search',
  ],
  compose: ['prepare', 'addAttachments', 'send', 'discard'],
} as const satisfies { [N in Namespace]: readonly (keyof Api[N])[] }

/**
 * Events from the main process to the UI. Not part of `Api`, because they
 * flow the other way: the preload script exposes them as `window.api.events`.
 */
export interface EventsApi {
  /** Called whenever cached mail changed. Returns a function that stops listening. */
  onMailChanged(listener: (change: MailChange) => void): () => void
}

export const EVENT_CHANNELS = {
  mailChanged: 'event:mail-changed',
} as const

/** What the UI sees as `window.api`. */
export interface RendererApi extends Api {
  events: EventsApi
}

/** IPC channel name for a method, e.g. "mail:listFolders". */
export function channelName(namespace: string, method: string): string {
  return `${namespace}:${method}`
}

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>

type AnyMethod = (...args: unknown[]) => Promise<unknown>

/** Builds the renderer-side `Api` object that forwards every call over IPC. */
export function createApiClient(invoke: Invoke): Api {
  const client: Record<string, Record<string, AnyMethod>> = {}
  for (const namespace of Object.keys(API_METHODS) as Namespace[]) {
    const methods: Record<string, AnyMethod> = {}
    for (const method of API_METHODS[namespace]) {
      methods[method] = (...args) => invoke(channelName(namespace, method), ...args)
    }
    client[namespace] = methods
  }
  return client as unknown as Api
}

// Compile-time check: every method of `Api` must be listed in `API_METHODS`.
type UnlistedMethods = {
  [N in Namespace]: Exclude<keyof Api[N], (typeof API_METHODS)[N][number]>
}
type AssertAllListed<T extends { [N in Namespace]: never }> = T
export type ApiMethodsAreComplete = AssertAllListed<UnlistedMethods>
