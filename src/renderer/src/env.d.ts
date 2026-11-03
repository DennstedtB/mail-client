import type { Api } from '@shared/ipc-contract'

declare global {
  interface Window {
    /** Provided by the preload script. The UI's only way to reach the backend. */
    api: Api
  }
}

export {}
