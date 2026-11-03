import { useState } from 'react'
import type { FolderId, MessageId } from '@shared/types/mail'
import { CalendarPlaceholder } from './components/CalendarPlaceholder'
import { MessageList } from './components/MessageList'
import { ReadingPane } from './components/ReadingPane'
import { Sidebar, type View } from './components/Sidebar'
import { useAsync } from './lib/use-async'

const api = window.api

export function App() {
  const [view, setView] = useState<View>('mail')
  const [chosenFolderId, setChosenFolderId] = useState<FolderId | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<MessageId | null>(null)

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
        appInfo={appInfo.status === 'ready' ? appInfo.data : undefined}
      />

      {view === 'mail' ? (
        <>
          <MessageList
            folder={folder}
            messages={messages}
            selectedId={openMessageId}
            onSelect={setSelectedMessageId}
          />
          <ReadingPane message={message} />
        </>
      ) : (
        <CalendarPlaceholder />
      )}
    </div>
  )
}
