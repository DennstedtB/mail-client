import { useState } from 'react'
import type { FolderId, MessageId, MessageSummary } from '@shared/types/mail'
import { CalendarPlaceholder } from './components/CalendarPlaceholder'
import { MessageList } from './components/MessageList'
import { ReadingPane } from './components/ReadingPane'
import { Sidebar, type View } from './components/Sidebar'
import { useAsync, type AsyncState } from './lib/use-async'
import { useToday } from './lib/use-today'

const api = window.api

export function App() {
  const [view, setView] = useState<View>('mail')
  const [chosenFolderId, setChosenFolderId] = useState<FolderId | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<MessageId | null>(null)
  const today = useToday()

  const appInfo = useAsync('app-info', () => api.app.getInfo())
  const accounts = useAsync('accounts', () => api.mail.listAccounts())

  // v1 shows one account; the data model already supports several.
  const account = accounts.status === 'ready' ? accounts.data[0] : undefined

  const folders = useAsync(account ? `folders:${account.id}` : null, () =>
    api.mail.listFolders(account!.id),
  )
  const folderList = folders.status === 'ready' ? folders.data : []
  const folder =
    folderList.find((f) => f.id === chosenFolderId) ?? folderList.find((f) => f.role === 'inbox')

  const messages = useAsync(account && folder ? `messages:${account.id}:${folder.id}` : null, () =>
    api.mail.listMessages(account!.id, folder!.id),
  )
  const messageInList =
    messages.status === 'ready' && messages.data.some((m) => m.id === selectedMessageId)
  const openMessageId = messageInList ? selectedMessageId : null

  const message = useAsync(
    account && openMessageId ? `message:${account.id}:${openMessageId}` : null,
    () => api.mail.getMessage(account!.id, openMessageId!),
  )

  // A failed load must not look like an empty mailbox: show the reason in the
  // sidebar and in the message list.
  const loadError =
    accounts.status === 'error'
      ? `Accounts could not be loaded: ${accounts.message}`
      : folders.status === 'error'
        ? `Folders could not be loaded: ${folders.message}`
        : undefined
  const noAccount = accounts.status === 'ready' && accounts.data.length === 0
  const sidebarNotice =
    loadError ?? (noAccount ? 'No account set up yet. Adding accounts arrives in M1.' : undefined)
  const listState: AsyncState<MessageSummary[]> = loadError
    ? { status: 'error', message: loadError }
    : messages.status === 'error'
      ? { status: 'error', message: `Messages could not be loaded: ${messages.message}` }
      : messages

  return (
    <div className="flex h-full">
      <Sidebar
        view={view}
        onViewChange={setView}
        account={account}
        folders={folderList}
        selectedFolderId={folder?.id}
        onSelectFolder={(id) => {
          setChosenFolderId(id)
          setSelectedMessageId(null)
        }}
        notice={sidebarNotice}
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
          />
          <ReadingPane message={message} />
        </>
      ) : (
        <CalendarPlaceholder now={today} />
      )}
    </div>
  )
}
