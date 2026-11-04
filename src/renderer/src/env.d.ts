import type { RendererApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    /** Provided by the preload script. The UI's only way to reach the backend. */
    api: RendererApi
  }
}

export {}
