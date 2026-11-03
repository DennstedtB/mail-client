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

import type {
  Account,
  AccountId,
  Folder,
  FolderId,
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
}

export interface AppApi {
  getInfo(): Promise<AppInfo>
}

export interface MailApi {
  listAccounts(): Promise<Account[]>
  listFolders(accountId: AccountId): Promise<Folder[]>
  /** Newest first. */
  listMessages(accountId: AccountId, folderId: FolderId): Promise<MessageSummary[]>
  getMessage(accountId: AccountId, messageId: MessageId): Promise<Message | null>
}

export interface Api {
  app: AppApi
  mail: MailApi
}

export type Namespace = keyof Api

export const API_METHODS = {
  app: ['getInfo'],
  mail: ['listAccounts', 'listFolders', 'listMessages', 'getMessage'],
} as const satisfies { [N in Namespace]: readonly (keyof Api[N])[] }

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
