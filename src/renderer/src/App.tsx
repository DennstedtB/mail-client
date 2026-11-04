import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ComposeKind, Draft } from '@shared/types/compose'
import type { Account, Folder, Message, MessageId, MessageSummary } from '@shared/types/mail'
import { AddAccountDialog } from './components/AddAccountDialog'
import { CalendarPlaceholder } from './components/CalendarPlaceholder'
import { ComposePane, type ComposeOutcome } from './components/ComposePane'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DiscardDraftDialog } from './components/DiscardDraftDialog'
import { MessageList, type SyncState } from './components/MessageList'
import { ReadingPane, type MessageAction } from './components/ReadingPane'
import { RemoveAccountDialog } from './components/RemoveAccountDialog'
import { Sidebar, type AccountFolders, type FolderSelection, type View } from './components/Sidebar'
import { Toast, type ToastMessage } from './components/Toast'
import { errorMessage } from './lib/errors'
import { useAsync, type AsyncState } from './lib/use-async'
import { useToday } from './lib/use-today'

const api = window.api

export function App() {
  const [view, setView] = useState<View>('mail')
  const [chosen, setChosen] = useState<
    FolderSelection | { accountId: string; folderId: null } | null
  >(null)
  const [selectedMessageId, setSelectedMessageId] = useState<MessageId | null>(null)
  const [accountsVersion, setAccountsVersion] = useState(0)
  const [mailVersion, setMailVersion] = useState(0)
  const [syncRequest, setSyncRequest] = useState(0)
  const [syncResult, setSyncResult] = useState<{ key: string; state: SyncState } | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Account | null>(null)
  const [compose, setCompose] = useState<{ draft: Draft; key: number } | null>(null)
  const composeChanged = useRef(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [searchText, setSearchText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<MessageSummary | null>(null)
  const today = useToday()

  // Search as you type, once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchText.trim()), 200)
    return () => clearTimeout(timer)
  }, [searchText])

  const showToast = useCallback((text: string, tone: ToastMessage['tone'] = 'done') => {
    setToast({ id: Date.now(), text, tone })
  }, [])
  const hideToast = useCallback(() => setToast(null), [])
  const setComposeChanged = useCallback((changed: boolean) => {
    composeChanged.current = changed
  }, [])

  /** Runs an action that leaves the compose pane; asks first if that would lose changes. */
  function leaveCompose(action: () => void) {
    if (!compose) return action()
    if (composeChanged.current) {
      setPendingAction(() => action)
      return
    }
    setCompose(null)
    action()
  }

  // The main process announces every change to cached mail: syncs, new mail via IDLE.
  useEffect(() => api.events.onMailChanged(() => setMailVersion((v) => v + 1)), [])

  const appInfo = useAsync('app-info', () => api.app.getInfo())
  const accounts = useAsync(`accounts:${accountsVersion}`, () => api.accounts.list())
  const accountList = accounts.status === 'ready' ? accounts.data : null
  const accountIds = accountList?.map((a) => a.id).join(',')

  // Folders of all accounts, loaded side by side. One failing account doesn't hide the others.
  const folders = useAsync(
    accountList ? `folders:${accountsVersion}:${accountIds}:${mailVersion}` : null,
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
    `folders:${accountIds}`,
  )

  // Selected folder: the one the user chose, otherwise the inbox of the chosen (or first) account.
  const selection = resolveSelection(chosen, accountList, folders)
  const accountFolders =
    folders.status === 'ready'
      ? folders.data.find((f) => f.accountId === selection?.accountId)
      : undefined
  const folder =
    accountFolders?.status === 'ready'
      ? accountFolders.folders.find((f) => f.id === selection?.folderId)
      : undefined
  const folderAccountId = folder?.accountId
  const folderId = folder?.id

  // Ask the server for news whenever a folder is shown, and on "Check for new mail".
  // The list itself comes from the cache and is there at once.
  const syncKey = folderId ? `${folderAccountId}:${folderId}:${syncRequest}` : null
  useEffect(() => {
    if (!folderAccountId || !folderId || !syncKey) return
    let current = true
    api.mail.syncFolder(folderAccountId, folderId).then(
      () => current && setSyncResult({ key: syncKey, state: { status: 'done' } }),
      (error: unknown) =>
        current &&
        setSyncResult({ key: syncKey, state: { status: 'error', message: errorMessage(error) } }),
    )
    return () => {
      current = false
    }
  }, [folderAccountId, folderId, syncKey])
  const sync: SyncState =
    syncResult && syncResult.key === syncKey ? syncResult.state : { status: 'running' }

  // The list shows search results (all folders of the account) or the selected folder.
  const searchAccountId = searchQuery && selection ? selection.accountId : null
  const messages = useAsync(
    searchAccountId
      ? `search:${searchAccountId}:${searchQuery}:${mailVersion}`
      : folder
        ? `messages:${folder.accountId}:${folder.id}:${mailVersion}`
        : null,
    () =>
      searchAccountId
        ? api.mail.search(searchAccountId, searchQuery)
        : api.mail.listMessages(folder!.accountId, folder!.id),
    searchAccountId
      ? `search:${searchAccountId}`
      : folder
        ? `messages:${folder.accountId}:${folder.id}`
        : undefined,
  )
  const items = messages.status === 'ready' ? messages.data : []
  const openSummary = items.find((m) => m.id === selectedMessageId)
  const openMessageId = openSummary?.id ?? null
  const message = useAsync(
    openSummary ? `message:${openSummary.accountId}:${openSummary.id}:${mailVersion}` : null,
    () => api.mail.getMessage(openSummary!.accountId, openSummary!.id),
    openSummary ? `message:${openSummary.id}` : undefined,
  )
  const accountFolderList: Folder[] =
    accountFolders?.status === 'ready' ? accountFolders.folders : []

  // Opening a message marks it as read, once per opening.
  const markedRead = useRef<MessageId | null>(null)
  useEffect(() => {
    if (message.status !== 'ready' || !message.data) return
    const opened = message.data
    if (markedRead.current === opened.id) return
    markedRead.current = opened.id
    if (!opened.isRead) {
      api.mail.setFlags(opened.accountId, [opened.id], { seen: true }).catch(() => undefined)
    }
  }, [message])

  /** After a message leaves the list, the next one (or the one before) is selected. */
  function selectNeighbour(of: MessageSummary) {
    if (selectedMessageId !== of.id) return
    const index = items.findIndex((m) => m.id === of.id)
    setSelectedMessageId(items[index + 1]?.id ?? items[index - 1]?.id ?? null)
  }

  async function moveTo(target: Folder, of: MessageSummary, done: string) {
    selectNeighbour(of)
    await api.mail.moveMessages(of.accountId, [of.id], target.id)
    showToast(done)
  }

  async function runAction(action: MessageAction, of: Message | MessageSummary) {
    const archive = accountFolderList.find((f) => f.role === 'archive')
    const trash = accountFolderList.find((f) => f.role === 'trash')
    try {
      switch (action.type) {
        case 'flag':
          await api.mail.setFlags(of.accountId, [of.id], { flagged: action.flagged })
          break
        case 'read':
          await api.mail.setFlags(of.accountId, [of.id], { seen: action.read })
          break
        case 'archive': {
          // Servers without an archive folder get one, as in Thunderbird.
          const target = archive ?? (await createArchive(of.accountId))
          await moveTo(target, of, 'Archived')
          break
        }
        case 'move': {
          const target = accountFolderList.find((f) => f.id === action.folderId)
          if (target) await moveTo(target, of, `Moved to ${target.name}`)
          break
        }
        case 'delete':
          // In the trash (or without one), deleting is for good, so ask first.
          if (!trash || of.folderId === trash.id) setConfirmDelete(of)
          else await moveTo(trash, of, `Moved to ${trash.name}`)
          break
      }
    } catch (error) {
      showToast(`That didn't work: ${errorMessage(error)}`, 'problem')
    }
  }

  async function createArchive(accountId: string): Promise<Folder> {
    const id = await api.mail.createFolder(accountId, 'Archive')
    return { id, accountId, name: 'Archive', role: 'archive', unreadCount: 0, totalCount: 0 }
  }

  async function deleteForGood(of: MessageSummary) {
    setConfirmDelete(null)
    selectNeighbour(of)
    try {
      await api.mail.deleteMessages(of.accountId, [of.id])
      showToast('Deleted')
    } catch (error) {
      showToast(`The message couldn't be deleted: ${errorMessage(error)}`, 'problem')
    }
  }

  const composeAccount = accountList?.find(
    (a) => a.id === (compose?.draft.accountId ?? selection?.accountId),
  )
  const composeUnavailable =
    composeAccount?.kind === 'mock' ? 'not available in the sample mailbox' : undefined

  function startCompose(kind: ComposeKind, accountId: string, sourceMessageId?: MessageId) {
    leaveCompose(() => {
      api.compose.prepare(kind, accountId, sourceMessageId).then(
        (draft) => {
          composeChanged.current = false
          setCompose({ draft, key: Date.now() })
        },
        (error: unknown) =>
          showToast(`Couldn't start the message: ${errorMessage(error)}`, 'problem'),
      )
    })
  }

  function closeCompose(outcome: ComposeOutcome) {
    setCompose(null)
    composeChanged.current = false
    // Sent while "Discard this message?" was open: nothing is lost anymore, so just go on.
    if (pendingAction) {
      setPendingAction(null)
      pendingAction()
    }
    if (outcome.type === 'sent') {
      showToast(
        outcome.copySaved ? 'Message sent' : "Message sent. Its copy couldn't be saved in Sent.",
        outcome.copySaved ? 'done' : 'problem',
      )
    }
  }

  // ⌘N starts a new message, as in other mail apps.
  const newMessage = useEffectEvent(() => {
    if (view === 'mail' && selection && !composeUnavailable)
      startCompose('new', selection.accountId)
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'n' &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault()
        newMessage()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const listState: AsyncState<MessageSummary[]> =
    messages.status === 'error'
      ? {
          status: 'error',
          message: `${searchAccountId ? 'Search failed' : 'Messages could not be loaded'}: ${messages.message}`,
        }
      : messages

  return (
    <div className="flex h-full">
      <Sidebar
        view={view}
        onViewChange={(next) => leaveCompose(() => setView(next))}
        accounts={accounts}
        folders={folders}
        selection={selection}
        onSelectFolder={(next) =>
          leaveCompose(() => {
            setChosen(next)
            setSelectedMessageId(null)
            setSearchText('')
            setSearchQuery('')
          })
        }
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
            onSelect={(id) => leaveCompose(() => setSelectedMessageId(id))}
            today={today}
            sync={sync}
            onRefresh={() => setSyncRequest((n) => n + 1)}
            onNewMessage={() => selection && startCompose('new', selection.accountId)}
            newMessageUnavailable={composeUnavailable}
            onDelete={(id) => {
              const target = items.find((m) => m.id === id)
              if (target) void runAction({ type: 'delete' }, target)
            }}
            search={{
              text: searchText,
              onTextChange: (text) => {
                setSearchText(text)
                // Clearing returns to the folder at once, without waiting for the pause.
                if (!text.trim()) setSearchQuery('')
              },
              active: Boolean(searchAccountId),
              folderName: (id) => accountFolderList.find((f) => f.id === id)?.name,
            }}
          />
          {compose && composeAccount ? (
            <ComposePane
              key={compose.key}
              initial={compose.draft}
              account={composeAccount}
              onClose={closeCompose}
              onChangedChange={setComposeChanged}
            />
          ) : (
            <ReadingPane
              message={message}
              onCompose={(kind, source) => startCompose(kind, source.accountId, source.id)}
              composeUnavailable={composeUnavailable}
              onAction={(action, of) => void runAction(action, of)}
              folders={accountFolderList}
            />
          )}
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
      <DiscardDraftDialog
        open={pendingAction !== null}
        onCancel={() => setPendingAction(null)}
        onDiscard={() => {
          const action = pendingAction
          setPendingAction(null)
          setCompose(null)
          composeChanged.current = false
          action?.()
        }}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this message for good?"
        text="It's removed from the server and can't be restored."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void deleteForGood(confirmDelete)}
      />
      <Toast toast={toast} onDone={hideToast} />
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
