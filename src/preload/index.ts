import { contextBridge, ipcRenderer } from 'electron'
import { createApiClient } from '@shared/ipc-contract'

// The only thing the UI gets from the main process: the typed API, nothing else.
contextBridge.exposeInMainWorld(
  'api',
  createApiClient((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
)
