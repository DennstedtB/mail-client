import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { createApiClient, EVENT_CHANNELS, type RendererApi } from '@shared/ipc-contract'
import type { MailChange } from '@shared/types/mail'

// The only thing the UI gets from the main process: the typed API and its events, nothing else.
const api: RendererApi = {
  ...createApiClient((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
  events: {
    onMailChanged(listener) {
      const handler = (_event: IpcRendererEvent, change: MailChange) => listener(change)
      ipcRenderer.on(EVENT_CHANNELS.mailChanged, handler)
      return () => {
        ipcRenderer.removeListener(EVENT_CHANNELS.mailChanged, handler)
      }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
