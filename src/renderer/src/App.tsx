import { useState } from 'react'
import type { Account, MessageId, MessageSummary } from '@shared/types/mail'
import { AddAccountDialog } from './components/AddAccountDialog'
import { CalendarPlaceholder } from './components/CalendarPlaceholder'
import { MessageList } from './components/MessageList'
import { ReadingPane } from './components/ReadingPane'
import { RemoveAccountDialog } from './components/RemoveAccountDialog'
import { Sidebar, type AccountFolders, type FolderSelection, type View } from './components/Sidebar'
import { errorMessage } from './lib/errors'
import { useAsync, type AsyncState } from './lib/use-async'
import { useToday } from './lib/use-today'

const api = window.api

/** Reading messages from real accounts comes with the local cache in M2. */
const MESSAGES_LATER =
  'Reading messages arrives in M2. The folders on the left come from your server.'

export function App() {
  const [view, setView] = useState<View>('mail')
  const [chosen, setChosen] = useState<
    FolderSelection | { accountId: string; folderId: null } | null
  >(null)
  const [selectedMessageId, setSelectedMessageId] = useState<MessageId | null>(null)
  const [accountsVersion, setAccountsVersion] = useState(0)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Account | null>(null)
  const today = useToday()

  const appInfo = useAsync('app-info', () => api.app.getInfo())
  const accounts = useAsync(`accounts:${accountsVersion}`, () => api.accounts.list())
  const accountList = accounts.status === 'ready' ? accounts.data : null

  // Folders of all accounts, loaded side by side. One failing account doesn't hide the others.
  const folders = useAsync(
    accountList ? `folders:${accountsVersion}:${accountList.map((a) => a.id).join(',')}` : null,
    () =>
      Promise.all(
        (accountList ?? []).map(async (account): Promise<AccountFolders> => {
          try {
            return {
              accountId: account.id,
              status: 'ready',
              folders: await api.mail.listFolders(account.id),
            }
          } catch (error) {
            return { accountId: account.id, status: 'error', message: errorMessage(error) }
          }
        }),
      ),
  )

  // Selected folder: the one the user chose, otherwise the inbox of the chosen (or first) account.
  const selection = resolveSelection(chosen, accountList, folders)
  const account = accountList?.find((a) => a.id === selection?.accountId)
  const accountFolders =
    folders.status === 'ready'
      ? folders.data.find((f) => f.accountId === selection?.accountId)
      : undefined
  const folder =
    accountFolders?.status === 'ready'
      ? accountFolders.folders.find((f) => f.id === selection?.folderId)
      : undefined

  const showsMessages = account?.kind === 'mock'
  const messages = useAsync(
    showsMessages && folder ? `messages:${folder.accountId}:${folder.id}` : null,
    () => api.mail.listMessages(folder!.accountId, folder!.id),
  )
  const messageInList =
    messages.status === 'ready' && messages.data.some((m) => m.id === selectedMessageId)
  const openMessageId = messageInList ? selectedMessageId : null
  const message = useAsync(
    folder && openMessageId ? `message:${folder.accountId}:${openMessageId}` : null,
    () => api.mail.getMessage(folder!.accountId, openMessageId!),
  )

  const listState: AsyncState<MessageSummary[]> =
    messages.status === 'error'
      ? { status: 'error', message: `Messages could not be loaded: ${messages.message}` }
      : messages

  return (
    <div className="flex h-full">
      <Sidebar
        view={view}
        onViewChange={setView}
        accounts={accounts}
        folders={folders}
        selection={selection}
        onSelectFolder={(next) => {
          setChosen(next)
          setSelectedMessageId(null)
        }}
        onAddAccount={() => setAdding(true)}
        onRemoveAccount={setRemoving}
        appInfo={appInfo.status === 'ready' ? appInfo.data : undefined}
      />

      {view === 'mail' ? (
        <>
          <MessageList
            folder={folder}
            messages={listState}
            selectedId={openMessageId}
            onSelect={setSelectedMessageId}
            today={today}
            note={account && !showsMessages && folder ? MESSAGES_LATER : undefined}
          />
          <ReadingPane
            message={message}
            empty={
              account && !showsMessages
                ? { title: 'No messages yet', hint: 'Reading mail from your server arrives in M2.' }
                : undefined
            }
          />
        </>
      ) : (
        <CalendarPlaceholder now={today} />
      )}

      <AddAccountDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(added) => {
          setAdding(false)
          setChosen({ accountId: added.id, folderId: null })
          setSelectedMessageId(null)
          setAccountsVersion((v) => v + 1)
        }}
        showLocalPreset={appInfo.status === 'ready' && appInfo.data.isDevelopment}
      />
      <RemoveAccountDialog
        account={removing}
        onClose={() => setRemoving(null)}
        onRemoved={(removed) => {
          setRemoving(null)
          if (chosen?.accountId === removed.id) setChosen(null)
          setSelectedMessageId(null)
          setAccountsVersion((v) => v + 1)
        }}
      />
    </div>
  )
}

function resolveSelection(
  chosen: FolderSelection | { accountId: string; folderId: null } | null,
  accounts: Account[] | null,
  folders: AsyncState<AccountFolders[]>,
): FolderSelection | undefined {
  if (!accounts || folders.status !== 'ready') return undefined
  const loaded = (id: string) =>
    folders.data.some((f) => f.accountId === id && f.status === 'ready')
  // The chosen account if it still exists, otherwise the first one whose folders loaded,
  // so one unreachable account doesn't leave the window without a selection.
  const accountId =
    chosen && accounts.some((a) => a.id === chosen.accountId)
      ? chosen.accountId
      : accounts.find((a) => loaded(a.id))?.id
  const result = folders.data.find((f) => f.accountId === accountId)
  if (!accountId || result?.status !== 'ready') return undefined
  const folder =
    result.folders.find((f) => f.id === chosen?.folderId) ??
    result.folders.find((f) => f.role === 'inbox') ??
    result.folders[0]
  return folder ? { accountId, folderId: folder.id } : undefined
}
